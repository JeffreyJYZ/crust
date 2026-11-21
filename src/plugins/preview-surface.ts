/**
 * The page-facing surface a platform half presents to `crust:preview`, plus the refusals for the
 * platforms that have no panel at all.
 *
 * The two halves differ in shape — macOS drives the system `QLPreviewPanel` and owns nothing, while
 * Windows creates a child host and sizes it — so this is the narrow contract the plugin speaks:
 * show one file, hide, and read back whether anything is on screen. A refusal names the API that was
 * missing, never a silent success.
 */
import { type NotImplemented, notImplemented } from "./define";

/** What `show` is given: an absolute path, and a size where 0 means "the panel's own". */
export interface SurfaceRequest {
	path: string;
	width: number;
	height: number;
}

/** A panel that is up. `window` is its own window number where the platform has one, else 0. */
export interface SurfaceShown {
	ok: true;
	window: number;
}

/** A platform that refused, in the caller's words: `requires` becomes the `not-implemented` selector. */
export interface SurfaceRefused {
	ok: false;
	message: string;
	requires: string;
}

export type SurfaceAnswer = SurfaceShown | SurfaceRefused;
export type HideAnswer = { ok: true } | SurfaceRefused;

export interface PreviewSurface {
	readonly name: string;
	show(request: SurfaceRequest): SurfaceAnswer;
	hide(): HideAnswer;
	visible(): boolean;
}

/**
 * The macOS adapter as this module consumes it, structurally: `darwinPreviewAdapter()` satisfies it,
 * and a test supplies four methods rather than a compiled QuickLook unit.
 */
export interface DarwinAdapter {
	available(): { available: boolean; reason: string };
	show(options: { path: string; width?: number; height?: number }): {
		ok: boolean;
		reason: string;
	};
	hide(): { ok: boolean; reason: string };
	visible(): boolean;
	windowNumber(): number;
}

/**
 * `QLPreviewPanel` over the app's own window. The panel floats, so nothing here owns a rectangle;
 * `visible()` is read from the panel itself, which is why the answer can say a preview is up rather
 * than that a call returned success.
 */
export function darwinSurface(adapter: DarwinAdapter): PreviewSurface {
	const refused = (reason: string): SurfaceRefused => ({
		ok: false,
		message: reason.length > 0 ? reason : "QLPreviewPanel refused the request",
		requires: "QLPreviewPanel",
	});
	return {
		name: "darwin",
		show(request) {
			const state = adapter.available();
			if (!state.available) return refused(state.reason);
			const outcome = adapter.show(request);
			if (!outcome.ok) return refused(outcome.reason);
			return { ok: true, window: adapter.windowNumber() };
		},
		hide() {
			const outcome = adapter.hide();
			return outcome.ok ? { ok: true } : refused(outcome.reason);
		},
		visible: () => adapter.visible(),
	};
}

/**
 * Windows has the host (`platform/windows/preview.ts`) but not a window to put it in: the surface is
 * a child HWND of the calling window, and this registration is handed no window handle. Refusing by
 * name beats a host created with parent 0, which the shim reports as `host-window` failure anyway.
 */
export function windowsRefusal(): NotImplemented {
	return notImplemented(
		"preview.show on Windows needs the app window's HWND to parent the IPreviewHandler host in, " +
			"and the preview registration receives no window handle; the COM host itself is " +
			"platform/windows/preview.ts",
		"the app window's HWND",
	);
}

/** Linux has no embedded system preview API at all, and that is the honest answer rather than a gap. */
export function linuxRefusal(): NotImplemented {
	return notImplemented(
		"Linux has no embedded system preview: there is no system preview API to embed, so " +
			"preview.show answers not-implemented — use opener.openPath to open the file in its own app",
		"an embedded system preview API (none exists on Linux)",
	);
}

/** Any other platform, named so the caller learns which one refused it. */
export function otherRefusal(os: string): NotImplemented {
	return notImplemented(
		`crust: preview needs a system preview API, and ${os} has none; use opener.openPath to open ` +
			"the file in its own app",
		"an embedded system preview API",
	);
}

/**
 * The platform's surface, or the refusal that names what is missing. Imported lazily for the reason
 * `runtime-keychain.ts` gives: a Linux or test process must never link QuickLookUI, and a Windows one
 * must not link AppKit.
 */
export async function resolvePreviewSurface(
	os: string = process.platform,
): Promise<PreviewSurface | NotImplemented> {
	if (os === "darwin") {
		const { darwinPreviewAdapter } = await import("@/platform/darwin/preview");
		return darwinSurface(darwinPreviewAdapter());
	}
	if (os === "win32") return windowsRefusal();
	if (os === "linux") return linuxRefusal();
	return otherRefusal(os);
}
