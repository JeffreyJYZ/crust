/**
 * The `loadUrl` command, split from `navigation.ts` so that file stays under the line cap. It is the one command that does not go through the shared `run` path: it carries a URL as well as a window label, so it reads both with `loadArgs` and refuses a bad URL before any native call. An adapter that cannot start a load answers `not-implemented` naming `loadRequest:`; no load is ever silently skipped.
 */

import { notImplemented, type NotImplemented, type PluginContext } from "./define";
import { failure, loadArgs } from "./navigation-target";
import type {
	NavigationAdapter,
	NavigationFailure,
	NavigationLoadUrlArgs,
} from "./navigation-types";

/** What the command needs from the plugin: the adapter and its no-adapter answer. */
export interface LoadUrlDeps {
	adapter: NavigationAdapter | undefined;
	missing: (command: string) => NotImplemented;
}

/** Point one window's webview at `url`; `loaded: false` means no webview was there. */
export function loadUrlCommand(
	deps: LoadUrlDeps,
	args: NavigationLoadUrlArgs,
	_ctx: PluginContext,
): { ok: true; loaded: boolean } | NavigationFailure | NotImplemented {
	const native = deps.adapter;
	if (!native) return deps.missing("loadUrl");
	const chosen = loadArgs(args);
	if ("ok" in chosen) return chosen;
	const load = native.loadUrl;
	if (typeof load !== "function") {
		return notImplemented(
			"navigation.loadUrl needs -[WKWebView loadRequest:] on the adapter's webview, which " +
				"this platform does not expose. No load was started.",
			"loadRequest:",
		);
	}
	try {
		return { ok: true as const, loaded: load.call(native, chosen.url, chosen.label) };
	} catch (error) {
		return failure(error);
	}
}
