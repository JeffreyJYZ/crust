/**
 * The macOS half of `crust:preview`: the system QuickLook panel, driven through `preview-unit.ts`.
 * The C half is its own unit, because QuickLookUI is a framework the window shim never links.
 * **The panel is not a child of the window.** It floats over it as its own window, which is why the
 * teardown is explicit: `previewWindowClosed` for a `window.close` path and `previewOwnerCheck` from
 * the pump for the window's own red button, which never reaches `Platform.destroy`. The panel repaints
 * only while the pump ticks, so a page doing long synchronous work freezes the preview — a visible
 * failure this layer cannot fix.
 * Like `opener.ts`, this imports no plugin: the adapter is a plain object, and the plugin lane takes
 * it structurally.
 */
import { existsSync } from "node:fs";
import { isAbsolute } from "node:path";
import {
	darwinPreviewNative,
	message,
	PREVIEW_STATUS,
	type PreviewNative,
	previewUnit,
	previewUnitStatus,
} from "./preview-unit.ts";

export { darwinPreviewNative, PREVIEW_STATUS, type PreviewNative, previewUnit, previewUnitStatus };
export { previewSource } from "./preview-unit.ts";

/** One answer, always a plain object: a refusal is data, never a thrown error. */
export interface PreviewOutcome {
	ok: boolean;
	status: number;
	/** The C side's own account of the send, including which selector refused it. */
	reason: string;
}

export interface PreviewShowOptions {
	/** Absolute path of the file to preview. Relative paths are refused here, not in C. */
	path: string;
	/** Panel size; both or neither, because a one-sided size would make a blank panel. */
	width?: number;
	height?: number;
	/** The native `NSWindow *` to float over, so a closed window can take the panel with it. */
	window?: number;
}

/** What the plugin lane calls; `show` and `hide` are the whole surface. */
export interface DarwinPreviewAdapter {
	available(): { available: boolean; reason: string };
	show(options: PreviewShowOptions): PreviewOutcome;
	hide(): PreviewOutcome;
	visible(): boolean;
	/** The panel's own window number, for a proof or a capture; 0 while no panel was ever made. */
	windowNumber(): number;
}

/** Whether any panel has been shown in this process — the pump's poll must cost nothing otherwise. */
let previewShown = false;

/** The adapter refusal for a path that is not an absolute path to a file that exists. */
export function absoluteRefusal(path: string): PreviewOutcome | undefined {
	if (!isAbsolute(path)) {
		return {
			ok: false,
			status: PREVIEW_STATUS.refused,
			reason: `crust: preview.show needs an absolute path, got ${JSON.stringify(path)}`,
		};
	}
	if (!existsSync(path)) {
		return {
			ok: false,
			status: PREVIEW_STATUS.noPaths,
			reason: `crust: preview.show found no file at ${path}`,
		};
	}
	return undefined;
}

/**
 * The macOS preview adapter. A relative path, or one naming no file, is refused before any AppKit
 * send; everything else is the C unit's answer, so a refusal says which selector was missing rather
 * than reporting success for a panel that never appeared.
 */
export function darwinPreviewAdapter(
	native: PreviewNative = darwinPreviewNative(),
): DarwinPreviewAdapter {
	const attempt = (run: () => number): PreviewOutcome => {
		try {
			const status = run();
			let reason = "";
			try {
				reason = native.reason();
			} catch {
				reason = "";
			}
			return { ok: status === PREVIEW_STATUS.ok, status, reason };
		} catch (error) {
			return { ok: false, status: PREVIEW_STATUS.refused, reason: message(error) };
		}
	};

	return {
		available() {
			try {
				if (native.available() === 1)
					return { available: true, reason: "QLPreviewPanel is reachable" };
				return { available: false, reason: native.reason() };
			} catch (error) {
				return { available: false, reason: message(error) };
			}
		},

		show(options) {
			const refused = absoluteRefusal(options.path);
			if (refused) return refused;
			let stored: number;
			try {
				stored = native.setPaths(options.path);
			} catch (error) {
				return { ok: false, status: PREVIEW_STATUS.refused, reason: message(error) };
			}
			if (stored !== 1) {
				return {
					ok: false,
					status: PREVIEW_STATUS.noPaths,
					reason: `crust: the panel stored ${stored} paths for one file`,
				};
			}
			// `window` is optional: with none the panel is the app's own and AppKit places it.
			const outcome = attempt(() =>
				native.show(options.window ?? 0, options.width ?? 0, options.height ?? 0),
			);
			if (outcome.ok) previewShown = true;
			return outcome;
		},

		hide: () => attempt(() => native.hide()),

		visible() {
			try {
				return native.visible();
			} catch {
				return false;
			}
		},

		windowNumber() {
			try {
				return native.windowNumber();
			} catch {
				return 0;
			}
		},
	};
}

/**
 * Order the panel out when the window it floats over is closing. Called from the window store's
 * `destroy`, because a panel left behind sits over an empty desktop with no way back. The owner
 * check keeps a second window's close from closing the first window's preview.
 */
export function previewWindowClosed(
	window: number,
	native: PreviewNative = darwinPreviewNative(),
): void {
	if (!previewShown || window === 0) return;
	try {
		if (native.owner() !== window) return;
		native.hide();
	} catch {
		// A window that closed anyway has nothing left to hide.
	}
}

/**
 * The pump's poll: hides the panel when the window it floats over is gone. A window closed with its
 * own red button never reaches `Platform.destroy`, so this is the only teardown that path gets.
 * Free when no panel was ever shown, which is every app that does not use `crust:preview`.
 */
export function previewOwnerCheck(native: PreviewNative = darwinPreviewNative()): void {
	if (!previewShown) return;
	try {
		native.ownerLive();
	} catch {
		// The panel is AppKit's; a refused read is not the app's failure.
	}
}
