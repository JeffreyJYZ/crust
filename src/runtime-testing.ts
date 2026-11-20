/**
 * The webview resolver every darwin plugin shares, and the testing adapter's install, split out of
 * `runtime-plugins.ts` when the window-frame wiring pushed that file past the line cap.
 */

import type { DarwinPlatform } from "@/platform/darwin";
import { type WebviewFor, webviewResolver } from "@/platform/darwin/webview-target";

/**
 * The `WKWebView` of one window, chosen by label and resolved per call so a window created after
 * registration is still reachable. With no label it is the app's first open window, which is what a
 * single-window caller means; a label that names no open window answers `bad-request` rather than
 * silently acting on that first window.
 */
export function darwinWebviews(platform: DarwinPlatform): WebviewFor {
	return webviewResolver(platform);
}

/**
 * Gated exactly like its registration (`core.ts`'s `testingEnabled`): a normal app never compiles the
 * evaluate unit, and an unregistered namespace is never reachable to grant. `webviewFor` is the
 * resolver navigation and find already use, so an unknown label refuses there.
 */
export async function installTestingAdapter(webviewFor: WebviewFor): Promise<void> {
	if (!(await import("@/plugins/core")).testingEnabled()) return;
	const { setTestingAdapter } = await import("@/plugins/testing");
	const { darwinTestingAdapter } = await import("@/plugins/testing-darwin");
	setTestingAdapter(darwinTestingAdapter(webviewFor));
}
