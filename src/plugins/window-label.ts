/**
 * `window.label` — which window the calling page is in.
 *
 * It cannot be answered, and this command says so by name instead of guessing. Every window
 * loads the same bridge document on one port with one token, and an invoke carries only
 * `{ plugin, command, args }`, so a request holds no window identity for the bridge to read.
 * Answering "the first open window" or "the focused one" would be a guess that looks like a
 * fact, which is the bug class the label-aware resolvers exist to end.
 *
 * The answer is `not-implemented` with the missing piece named in `requires`, the same shape
 * every other command uses when the framework cannot do a thing yet. A page that needs its own
 * identity reads the URL the app opened it with (`?window=…`), or passes a label explicitly to
 * the command that needs one — which is what the label-aware `navigation.*` and
 * `findinpage.*` now accept.
 */

import { notImplemented, type NotImplemented } from "./define";

/** What a per-window identity would have to be carried by, named for the caller. */
export const WINDOW_LABEL_REQUIRES = "a per-window identity on the bridge invoke request";

/**
 * The refusal, with no adapter consulted: no platform can supply what the bridge never saw,
 * so asking one would only turn a clear answer into an `unknown-adapter`.
 */
export function labelCommand(): NotImplemented {
	return notImplemented(
		"window.label cannot name the window this request came from: every window loads the same " +
			"bridge document on one port with one token, and an invoke carries only " +
			"{ plugin, command, args }, so the bridge holds no window identity. Read the label from " +
			"the URL the app opened this window with, or pass it explicitly to the command that needs it.",
		WINDOW_LABEL_REQUIRES,
	);
}
