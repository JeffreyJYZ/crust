/**
 * The native half of `crust:dialog` on Windows: `GetOpenFileNameW` and `GetSaveFileNameW` from
 * comdlg32, and `SHBrowseForFolderW` for a folder. The plugin contract is unchanged — `openPanel`,
 * `savePanel` and `cancel`, each answering `{ paths }` where `[]` means the human cancelled.
 *
 * **The panel is modal on the calling thread.** It runs on Bun's main thread, which is the thread
 * that owns the HWND and the one COM was initialised on, so the modal cannot deadlock against a pump
 * on another thread — the failure this platform could have shipped. What it costs is JavaScript:
 * comdlg32 runs its own message loop, so the window keeps painting, but no timer and no in-flight
 * invoke runs until the human answers. Win32 has no non-blocking file picker, so there is nothing to
 * offer instead, and `cancel` is honestly `{ cancelled: false }`: by the time any JavaScript could
 * ask, the panel has already returned.
 *
 * A status of 0 and a status of -3 are different answers, never one "failure": 0 is the human's
 * cancel, and -3 is comdlg32 refusing with the code `CommDlgExtendedError` returned.
 * `directory` goes through `SHBrowseForFolderW`, which picks one folder by nature, so `multiple`
 * adds nothing there — the contract allows it and the platform cannot honour it.
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
import { activeWindowsPlatform } from "./active-platform.ts";
import type { WindowsShim } from "./backend.ts";
import { cstring } from "./cstring.ts";

/** Re-exported so a caller reading the Windows half finds the bound and the wire format beside it. */
export { DIALOG_MAX_PATHS, filterSpec };

/** The panel symbols, so a fake supplies six members rather than the whole Win32 table. */
export type WindowsDialogShim = Pick<
	WindowsShim,
	| "shim_dialog_open"
	| "shim_dialog_save"
	| "shim_dialog_count"
	| "shim_dialog_path"
	| "shim_dialog_error"
	| "shim_dialog_missing"
>;

/** What the C side answers, named so the mapping below reads as answers rather than numbers. */
export const DIALOG_STATUS = {
	picked: 1,
	cancelled: 0,
	missing: -2,
	refused: -3,
} as const;

/** The HWND the panel is modal to: the first open window, or 0 for a windowless app. */
export function defaultDialogOwner(): number {
	const platform = activeWindowsPlatform();
	if (platform === undefined) return 0;
	for (const label of platform.windowLabels()) {
		const hwnd = platform.nativeWindow(label);
		if (hwnd !== undefined) return hwnd;
	}
	return 0;
}

export interface WindowsDialogOptions {
	/** The shim to call; defaults to the running platform's, which is undefined before `start()`. */
	shim?: () => WindowsDialogShim | undefined;
	/** The owner HWND; defaults to the first open window. */
	owner?: () => number;
}

/** The adapter's own shape: `DialogNative` plus the two commands' names, as the darwin half has. */
export interface WindowsDialogAdapter extends DialogNative {
	openPanel(options: OpenPanelOptions): Promise<OpenPanelResult>;
	savePanel(options: SavePanelOptions): Promise<SavePanelResult>;
	pickSave(options: SavePanelOptions): Promise<SavePanelResult>;
	cancel(): Promise<CancelPanelResult>;
}

export function windowsDialogAdapter(options: WindowsDialogOptions = {}): WindowsDialogAdapter {
	const shimOf = options.shim ?? (() => activeWindowsPlatform()?.shim());
	const ownerOf = options.owner ?? defaultDialogOwner;

	const native = (command: string): WindowsDialogShim => {
		const shim = shimOf();
		if (shim === undefined) {
			throw new Error(
				`crust: ${command} needs a started Windows platform — the panels are comdlg32, ` +
					`and no shim is loaded before start()`,
			);
		}
		return shim;
	};

	/** The one place a status becomes an answer or a refusal, so both panels agree. */
	const answered = (shim: WindowsDialogShim, status: number, command: string): OpenPanelResult => {
		if (status === DIALOG_STATUS.cancelled) return { paths: [] };
		if (status === DIALOG_STATUS.missing) {
			const absent = String(shim.shim_dialog_missing() ?? "") || "a comdlg32 entry point";
			throw new Error(`crust: ${command} cannot show a panel: ${absent} did not resolve`);
		}
		if (status !== DIALOG_STATUS.picked) {
			const code = Number(shim.shim_dialog_error() ?? 0);
			throw new Error(
				`crust: ${command} was refused (status ${status}, CommDlgExtendedError ${hex(code)})`,
			);
		}
		const count = Number(shim.shim_dialog_count() ?? 0);
		if (!Number.isInteger(count) || count < 1 || count > DIALOG_MAX_PATHS) {
			throw new Error(
				`crust: ${command} reported ${count} paths, outside 1…${DIALOG_MAX_PATHS}`,
			);
		}
		const paths: string[] = [];
		for (let index = 0; index < count; index++) {
			const path = String(shim.shim_dialog_path(index) ?? "");
			if (path.length === 0) {
				throw new Error(`crust: ${command} answered a pick with an empty path at ${index}`);
			}
			paths.push(path);
		}
		return { paths };
	};

	const pickOpen = async (panel: OpenPanelOptions = {}): Promise<OpenPanelResult> => {
		const shim = native("openPanel");
		const status = Number(
			shim.shim_dialog_open(
				cstring(panel.title ?? ""),
				cstring(filterSpec(panel.filters)),
				panel.multiple ? 1 : 0,
				panel.directory ? 1 : 0,
				ownerOf(),
			) ?? DIALOG_STATUS.refused,
		);
		return answered(shim, status, "openPanel");
	};

	const pickSave = async (panel: SavePanelOptions = {}): Promise<SavePanelResult> => {
		const shim = native("savePanel");
		const status = Number(
			shim.shim_dialog_save(
				cstring(panel.title ?? ""),
				cstring(panel.suggestedName ?? ""),
				cstring(filterSpec(panel.filters)),
				ownerOf(),
			) ?? DIALOG_STATUS.refused,
		);
		return answered(shim, status, "savePanel");
	};

	/**
	 * Nothing is ever pending: the modal owns the thread, so no JavaScript runs while it is up and
	 * there is no sheet for a page to end. `cancelled: false` is that fact, not a gap.
	 */
	const cancel = async (): Promise<CancelPanelResult> => ({ cancelled: false, paths: [] });

	return { pickOpen, pickSave, openPanel: pickOpen, savePanel: pickSave, cancel };
}

/** `CommDlgExtendedError` as the hex a Win32 developer recognises; 0 stays 0. */
function hex(code: number): string {
	return code === 0 ? "0" : `0x${(code >>> 0).toString(16).padStart(8, "0")}`;
}
