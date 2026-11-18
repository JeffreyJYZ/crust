/**
 * `window.label` — which window the calling page is in.
 *
 * The identity is carried by the URL the window was opened with: `windowUrl` appends
 * `?window=<label>` when the configured URL names no window, the bridge reads it off the document
 * request and injects it into the page client, and the page sends it on every invoke. The bridge
 * hands it to this handler as `ctx.window`, so the answer is the label the *calling* request
 * carried — never the first open window, the focused one, or the only one.
 *
 * A client-supplied label is a routing hint, never the authority. The bridge binds a label to each
 * document token when it serves the page and gates capabilities on that bound label, so a page that
 * writes another label into its invoke body can misdirect routing but cannot inherit that window's
 * grants. This command answers the routing label this request carried, not the authority label.
 *
 * Why the page sends it rather than the bridge reading `Referer`: the served document carries
 * `referrer-policy: no-referrer`, and in dev the page's origin is the Vite server, so a
 * cross-origin fetch would send at most the origin — no path, no query. There is no request header
 * that names the window, which is why the page's own search string is the honest route.
 */

import { notImplemented, type NotImplemented } from "./define";

/** What a request has to carry for this command to answer. */
export const WINDOW_LABEL_REQUIRES = "the calling page's window identity on the invoke request";

/** The answer when the request carried an identity. */
export interface WindowLabelResult {
	readonly ok: true;
	readonly label: string;
}

/** Either the label this request carried, or the named reason it carried none. */
export type WindowLabelAnswer = WindowLabelResult | NotImplemented;

/**
 * Answer the label this request carried. No adapter is consulted: the platform knows which windows
 * exist, not which one asked, so asking it would turn a clear answer into a guess — and a guess
 * that looks like a fact is the bug class the label-aware resolvers exist to end.
 */
export function labelCommand(window?: string): WindowLabelAnswer {
	const label = typeof window === "string" ? window.trim() : "";
	if (label.length > 0) return { ok: true, label };
	return notImplemented(
		"window.label cannot name the window this request came from: the invoke carried no window " +
			"identity. A window crust opened carries `?window=<label>` in its URL and the page client " +
			"sends it with every call; a page the bridge did not open that way has none, and this " +
			"command will not guess one.",
		WINDOW_LABEL_REQUIRES,
	);
}
