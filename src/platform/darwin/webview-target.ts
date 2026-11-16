/**
 * Which window's `WKWebView` a native surface acts on, chosen by label. The window registry
 * keeps the pointer each window was built with, so a caller that knows a label reaches that
 * window's view directly; with no label it means the app's first open window, which is what a
 * single-window caller has always meant.
 * The reason this exists: the resolver used to be built from `windowLabels()[0]` alone, so in a
 * multi-window app navigation, find-in-page and downloads all acted on the first window
 * silently. A label that names no open window is a refusal here, never a fall back to that
 * first window — the wrong window is not an error, it is just wrong.
 */

import { CrustError } from "@/bridge/errors";

/** The two reads a resolver needs; `DarwinPlatform` already answers both. */
export interface WebviewWindows {
	/** The labels this platform still tracks, in creation order. */
	windowLabels(): string[];
	/** The `WKWebView *` behind one label; undefined when never created or now closed. */
	webview(label: string): number | undefined;
}

/**
 * Resolve a label to a `WKWebView *`: no label is the first open window, `null` is a window
 * with no view, and an unknown label throws `bad-request` naming it.
 */
export type WebviewFor = (label?: string) => number | null;

/**
 * An adapter whose every command takes the window label as its last argument, so a plugin can
 * name a window and a single-window caller keeps passing nothing. The plugin's own interface
 * keeps its shape; this is only the wider signature the darwin half really has.
 */
export type LabeledAdapter<T> = {
	[K in keyof T]: T[K] extends (...args: infer A) => infer R
		? (...args: [...A, label?: string]) => R
		: T[K];
};

export function webviewResolver(windows: WebviewWindows): WebviewFor {
	return (label) => {
		const labels = windows.windowLabels();
		const chosen = label ?? labels[0];
		if (chosen === undefined) return null;
		if (!labels.includes(chosen)) {
			throw new CrustError(
				"bad-request",
				`crust: there is no open window ${JSON.stringify(chosen)}; open windows: ${JSON.stringify(labels)}`,
			);
		}
		const view = windows.webview(chosen);
		return view === undefined || view === 0 ? null : view;
	};
}
