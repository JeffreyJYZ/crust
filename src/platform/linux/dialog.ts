/**
 * The native half of `crust:dialog` on Linux: `GtkFileChooserNative`, shown with
 * `gtk_native_dialog_show` and answered through its `"response"` signal.
 *
 * **Why not `gtk_dialog_run` / `gtk_native_dialog_run`.** Both run a nested `GMainLoop` on the
 * calling thread, which here is Bun's main thread — the same thread the shim's pump slices run on.
 * The nested loop would not deadlock: it iterates the same default `GMainContext` the pump iterates,
 * and nothing in the shim caches context state, so it would return cleanly. It would simply block
 * every timer for as long as the panel was up, which is exactly what the darwin sheet path exists to
 * avoid. `show` returns at once and the signal arrives inside a normal `g_main_context_iteration`
 * slice, so the pump, the page and `dialog.cancel` all keep working — and cancelling is a real
 * answer here, not a permanent `{ cancelled: false }`.
 *
 * A modal still needs a person: nothing on this machine can click GTK, so what the tests prove is
 * the argument mapping, the status machine and the cancel path, never the click.
 */
import type {
	CancelPanelResult,
	DialogNative,
	OpenPanelOptions,
	OpenPanelResult,
	SavePanelOptions,
	SavePanelResult,
} from "@/plugins/dialog";
import { DIALOG_MAX_PATHS, filterSpec } from "@/plugins/dialog-transport";
import { cstring } from "./cstring.ts";
import type { LinuxPlatform } from "./platform.ts";
import { type LinuxShim, shim } from "./shim-ffi.ts";

/** `shim_dialog_status`: 0 idle, 1 pending, 2 accepted, 3 cancelled. */
export const LINUX_DIALOG_STATUS = {
	idle: 0,
	pending: 1,
	accepted: 2,
	cancelled: 3,
} as const;

/** How often the wait re-reads the status; the signal itself lands in a pump slice. */
export const DIALOG_POLL_INTERVAL_MS = 50;

/** What `shim_dialog_open`/`shim_dialog_save` answer: 1 started, -2 an entry point is absent, -3 refused. */
export const LINUX_DIALOG_START = { started: 1, missing: -2, refused: -3 } as const;

/** The adapter's own shape: `DialogNative` plus the two commands' names, as the darwin half has. */
export interface LinuxDialogAdapter extends DialogNative {
	openPanel(options: OpenPanelOptions): Promise<OpenPanelResult>;
	savePanel(options: SavePanelOptions): Promise<SavePanelResult>;
	pickSave(options: SavePanelOptions): Promise<SavePanelResult>;
	cancel(): Promise<CancelPanelResult>;
}

export function linuxDialogAdapter(
	platform?: LinuxPlatform,
	native: LinuxShim = shim().symbols,
): LinuxDialogAdapter {
	/** The one gate: GTK 3.20 carries GtkFileChooserNative, an older GTK does not, and that is a name. */
	const gate = (command: string): void => {
		if (Number(native.shim_dialog_ready?.() ?? 0) === 1) return;
		const absent = String(native.shim_dialog_missing?.() ?? "") || "gtk_file_chooser_native_new";
		throw new Error(
			`crust: ${command} needs GtkFileChooserNative (GTK 3.20+): ${absent} did not resolve`,
		);
	};

	/** The `GtkWindow *` the panel is transient for: the first open window, or none. */
	const parent = (): bigint => {
		if (platform === undefined) return 0n;
		for (const label of platform.windowLabels()) {
			const win = platform.nativeWindow(label)?.win;
			if (win !== undefined) return win;
		}
		return 0n;
	};

	/** The page's way out of the panel it has in flight, if any. */
	let pending: { abandon(): void } | null = null;

	/** The paths of an accepted panel, checked before they are believed. */
	const readPaths = (command: string): string[] => {
		const count = Number(native.shim_dialog_count?.() ?? 0);
		if (!Number.isInteger(count) || count < 1 || count > DIALOG_MAX_PATHS) {
			throw new Error(
				`crust: ${command} reported ${count} paths, outside 1…${DIALOG_MAX_PATHS}`,
			);
		}
		const paths: string[] = [];
		for (let index = 0; index < count; index++) {
			const path = String(native.shim_dialog_path?.(index) ?? "");
			if (path.length === 0) {
				throw new Error(`crust: ${command} answered a pick with an empty path at ${index}`);
			}
			paths.push(path);
		}
		return paths;
	};

	/**
	 * Await the answer without blocking: the status is re-read on a timer, so the pump slice that
	 * runs the response signal is never held up by this wait. `abandoned` is the page's own cancel
	 * reaching the wait, checked before every read, so a cancelled panel replaced by a new one can
	 * never report the replacement's answer as its own.
	 */
	const awaitAnswer = async (command: string): Promise<OpenPanelResult> => {
		const request = { abandoned: false };
		const abandon = (): void => {
			request.abandoned = true;
		};
		pending = { abandon };
		try {
			for (;;) {
				if (request.abandoned) return { paths: [] };
				const status = Number(native.shim_dialog_status?.() ?? 0);
				if (status === LINUX_DIALOG_STATUS.accepted) {
					const paths = readPaths(command);
					native.shim_dialog_release?.();
					return { paths };
				}
				if (status === LINUX_DIALOG_STATUS.cancelled) {
					native.shim_dialog_release?.();
					return { paths: [] };
				}
				if (status !== LINUX_DIALOG_STATUS.pending) {
					throw new Error(`crust: ${command} lost its panel (status ${status})`);
				}
				await new Promise<void>((resolve) => setTimeout(resolve, DIALOG_POLL_INTERVAL_MS));
			}
		} finally {
			if (pending?.abandon === abandon) pending = null;
		}
	};

	const started = (status: number, command: string): void => {
		if (status === LINUX_DIALOG_START.started) return;
		if (status === LINUX_DIALOG_START.missing) {
			gate(command);
			throw new Error(`crust: ${command} could not resolve a panel entry point`);
		}
		throw new Error(`crust: ${command} could not be shown (status ${status})`);
	};

	const pickOpen = async (panel: OpenPanelOptions = {}): Promise<OpenPanelResult> => {
		gate("openPanel");
		const status = Number(
			native.shim_dialog_open?.(
				cstring(panel.title ?? ""),
				cstring(filterSpec(panel.filters)),
				panel.multiple ? 1 : 0,
				panel.directory ? 1 : 0,
				parent(),
			) ?? LINUX_DIALOG_START.refused,
		);
		started(status, "openPanel");
		return awaitAnswer("openPanel");
	};

	const pickSave = async (panel: SavePanelOptions = {}): Promise<SavePanelResult> => {
		gate("savePanel");
		const status = Number(
			native.shim_dialog_save?.(
				cstring(panel.title ?? ""),
				cstring(panel.suggestedName ?? ""),
				cstring(filterSpec(panel.filters)),
				parent(),
			) ?? LINUX_DIALOG_START.refused,
		);
		started(status, "savePanel");
		return awaitAnswer("savePanel");
	};

	/**
	 * End the panel the way its Cancel button would. Nothing pending is `{ cancelled: false }` rather
	 * than an error: a page races the human's own click all the time, so "the panel was already gone"
	 * is an ordinary state and an error would make a completed pick look like a broken cancel.
	 */
	const cancel = async (): Promise<CancelPanelResult> => {
		if (Number(native.shim_dialog_cancel?.() ?? 0) !== 1) return { cancelled: false, paths: [] };
		pending?.abandon();
		native.shim_dialog_release?.();
		return { cancelled: true, paths: [] };
	};

	return { pickOpen, pickSave, openPanel: pickOpen, savePanel: pickSave, cancel };
}
