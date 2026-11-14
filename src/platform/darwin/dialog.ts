/**
 * The native half of `crust:dialog` on macOS.
 *
 * `pickOpen` is the plugin's adapter hook; `openPanel` is the same function
 * under the name the plugin's command is called by, so either shape reads
 * correctly at the call site.
 *
 * **The pick does not block while a window is open.** The panel is started as a
 * sheet (`beginSheetModalForWindow:completionHandler:`), the C-side completion
 * handler records the answer, and this adapter awaits it by polling the done
 * flag on a timer — so the JavaScript thread, the Cocoa pump and every in-flight
 * invoke keep running while the sheet is on screen. A sheet needs a window to
 * attach to; with none, the pick falls back to `-runModal`, which does block for
 * the whole pick. That fallback is the only blocking path and is chosen by the
 * shim's `SHIM_PANEL_NO_WINDOW`, never by this adapter guessing.
 *
 * `filters` are applied as extension strings: a filter list is flattened, each
 * entry stripped of a leading `*.` or `.`, de-duplicated, and handed to C as one
 * comma-separated string, because a JS array cannot cross the boundary. macOS 27
 * deprecates `-setAllowedFileTypes:` in favour of `allowedContentTypes` UTType
 * objects, which would be a second object graph inside C; the deprecated setter
 * still works and is guarded like every other selector.
 */
import type {
	CancelPanelResult,
	DialogNative,
	OpenPanelOptions,
	OpenPanelResult,
	SavePanelOptions,
	SavePanelResult,
} from "@/plugins/dialog";
import { darwinPanelShim, extensionList, type PanelShim, sheetReadings } from "./panel-shim.ts";
import {
	busyRefusal,
	PANEL_STATUS,
	SHEET_CANCEL_TIMEOUT_MS,
	SHEET_POLL_INTERVAL_MS,
} from "./panel-status.ts";
import { awaitSheetResult } from "./sheet.ts";

export interface DarwinDialogAdapter extends DialogNative {
	openPanel(options: OpenPanelOptions): Promise<OpenPanelResult>;
	savePanel(options: SavePanelOptions): Promise<SavePanelResult>;
	pickSave(options: SavePanelOptions): Promise<SavePanelResult>;
	cancel(): Promise<CancelPanelResult>;
}

/** Build the dialog adapter. The shim compiles on the first pick, not before. */
export function darwinDialogAdapter(
	/** The panel shim; overridable so a test can drive this with fakes. */
	native: PanelShim = darwinPanelShim(),
): DarwinDialogAdapter {
	/** Decode a status the shim answered with synchronously. */
	const immediate = (status: number, command = "openPanel"): OpenPanelResult => {
		if (status === PANEL_STATUS.busy) throw new Error(busyRefusal(command, native.sheetKind()));
		if (status === PANEL_STATUS.cancelled) return { paths: [] };
		if (status !== PANEL_STATUS.picked) {
			const name =
				Object.entries(PANEL_STATUS).find(([, value]) => value === status)?.[0] ??
				`status ${status}`;
			const cls = command === "savePanel" ? "NSSavePanel" : "NSOpenPanel";
			throw new Error(`crust: ${command} failed (${name}); ${cls} could not be shown`);
		}

		const count = native.panelCount();
		const paths: string[] = [];
		for (let index = 0; index < count; index++) paths.push(native.panelPath(index));
		return { paths };
	};

	/**
	 * The page's way out of the sheet it has in flight, if any.
	 *
	 * It is one slot because the C side is one sheet: a second request answers
	 * `busy` instead of starting, so there is never more than one to abandon.
	 */
	let pending: { abandon(): void } | null = null;

	/** Await one started sheet, stoppable by `cancel` before the next read. */
	const awaitSheet = (command: string): Promise<OpenPanelResult> => {
		const request = { abandoned: false };
		const abandon = (): void => {
			request.abandoned = true;
		};
		pending = { abandon };
		return awaitSheetResult(sheetReadings(native), {
			command,
			abandoned: () => request.abandoned,
		}).finally(() => {
			if (pending?.abandon === abandon) pending = null;
		});
	};

	const pickOpen = async (options: OpenPanelOptions = {}): Promise<OpenPanelResult> => {
		/** One call into `shim_open_panel`; `runModal` picks the sheet or the fallback. */
		const send = (runModal: number): number =>
			native.openPanel(
				options.title ?? "",
				extensionList(options.filters),
				options.directory ? 1 : 0,
				options.multiple ? 1 : 0,
				runModal,
			);

		// The sheet path first: it returns at once, with the answer to come.
		const sheet = send(0);
		if (sheet === PANEL_STATUS.sheetStarted) return await awaitSheet("openPanel");

		// No window to attach a sheet to, so the panel is presented on its own.
		// It still reports through the sheet poll — the shim uses
		// `-beginWithCompletionHandler:` rather than the blocking `-runModal`,
		// which is what lets a windowless app cancel or await it.
		if (sheet === PANEL_STATUS.noWindow) {
			const free = send(1);
			if (free === PANEL_STATUS.sheetStarted) return await awaitSheet("openPanel");
			return immediate(free);
		}

		return immediate(sheet);
	};

	/**
	 * The save panel, with the same sheet-first flow. AppKit asks before
	 * replacing an existing file; nothing here suppresses that or asks again.
	 */
	const pickSave = async (options: SavePanelOptions = {}): Promise<SavePanelResult> => {
		const send = (runModal: number): number =>
			native.savePanel(
				options.title ?? "",
				options.suggestedName ?? "",
				extensionList(options.filters),
				runModal,
			);

		const sheet = send(0);
		if (sheet === PANEL_STATUS.sheetStarted) return await awaitSheet("savePanel");
		if (sheet === PANEL_STATUS.noWindow) {
			const free = send(1);
			if (free === PANEL_STATUS.sheetStarted) return await awaitSheet("savePanel");
			return immediate(free, "savePanel");
		}

		return immediate(sheet, "savePanel");
	};

	/**
	 * End the sheet that is up, the way its Cancel button would.
	 *
	 * Nothing pending is `{ cancelled: false }`, not an error: a page races the
	 * user's own click all the time, so "the sheet was already gone" is an
	 * ordinary state it acts on. An error would make a completed pick look like
	 * a broken cancel, and there is nothing to retry or report.
	 */
	const cancel = async (): Promise<CancelPanelResult> => {
		if (native.sheetCancel() !== 1) return { cancelled: false, paths: [] };

		// -cancel: ends the sheet through the same path the Cancel button takes,
		// but the answer arrives in the completion handler. Waiting for it is
		// what makes the release real: until that handler runs, the state the
		// next request resets is still the live sheet's.
		const deadline = Date.now() + SHEET_CANCEL_TIMEOUT_MS;
		while (!native.sheetDone()) {
			if (Date.now() >= deadline) {
				throw new Error(
					`crust: cancel sent -cancel: but the sheet had not ended ` +
						`${SHEET_CANCEL_TIMEOUT_MS} ms later`,
				);
			}
			await new Promise<void>((resolve) => setTimeout(resolve, SHEET_POLL_INTERVAL_MS));
		}

		// An empty list is exactly what a cancel means, so the page's own pick
		// answers with the same value a human's cancel gives it. Abandoning it
		// rather than settling it keeps one path to an answer: the poll checks
		// this before its next read, so it cannot report the next panel's state.
		pending?.abandon();
		return { cancelled: true, paths: [] };
	};

	return { pickOpen, pickSave, openPanel: pickOpen, savePanel: pickSave, cancel };
}
