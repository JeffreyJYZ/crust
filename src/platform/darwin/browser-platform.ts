/**
 * Where a browser surface's host window comes from. `featurePlugins` builds the browser plugin
 * before the darwin arm of `runtime-plugins.ts` is reached and it is not handed the platform, so the
 * `DarwinPlatform` instance registers itself here when it is constructed. One reference, set once,
 * and the plugin reads it per command — a window created after registration is still reachable.
 *
 * A label that names no open window is the same `bad-request` the webview resolver gives, never a
 * silent fall back to the first window: the wrong window is not an error, it is just wrong.
 */
import { CrustError } from "@/bridge/errors";
import type { DarwinPlatform } from "./platform.ts";

/** The two reads a surface's host needs; `DarwinPlatform` already answers both. */
export type BrowserWindowHost = Pick<DarwinPlatform, "windowLabels" | "nativeWindow">;

/** A window and the label it was chosen by, so a surface can watch that window later. */
export interface BrowserOwner {
	label: string;
	win: number;
}

let host: BrowserWindowHost | undefined;

/** Called from the `DarwinPlatform` constructor; the last instance built is the running one. */
export function bindBrowserWindows(platform: BrowserWindowHost): void {
	host = platform;
}

/**
 * The `NSWindow *` one `owner` label names. No label is the app's first open window; an unknown one
 * throws `bad-request` naming it. `undefined` means no platform has registered yet, never a silent
 * success.
 */
export function browserOwner(label?: string): BrowserOwner | undefined {
	if (host === undefined) return undefined;
	const labels = host.windowLabels();
	const chosen = label ?? labels[0];
	if (chosen === undefined) {
		throw new CrustError(
			"bad-request",
			"browser.open: there is no open window to host a surface",
		);
	}
	if (!labels.includes(chosen)) {
		throw new CrustError(
			"bad-request",
			`crust: there is no open window ${JSON.stringify(chosen)}; open windows: ${JSON.stringify(labels)}`,
		);
	}
	const win = host.nativeWindow(chosen) ?? 0;
	return win === 0 ? undefined : { label: chosen, win };
}

/** Whether the window a surface was opened in is still open, so a closed one prunes its surfaces. */
export function browserWindowOpen(label: string): boolean {
	if (host === undefined) return false;
	return host.windowLabels().includes(label);
}
