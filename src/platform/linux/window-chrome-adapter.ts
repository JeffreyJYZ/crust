/**
 * The labelled half of the chrome commands on GTK: the title bar and the opacity. Both are written
 * and then read back, so a GTK that ignored the value is an error rather than a success — the same
 * rule `setTitle` follows, because a command that reports what it asked for instead of what the
 * window shows is the one that makes a caller trust a no-op.
 * Unlike AppKit's style mask, `gtk_window_set_decorated` does not move the frame, so there is no
 * read-the-frame-first-and-restore rule here.
 * The pointer pair refuses: GTK3 has no process-wide cursor, only a per-`GdkWindow` one, and hiding
 * it needs a blank cursor installed on every window — so answering "the pointer is hidden" for the
 * app while only one window's pointer moved would be a lie.
 */
import { WindowAdapterError, type WindowChromeNative } from "@/plugins/window";
import { type Refusal, refuse, type WindowSends } from "./window-sends.ts";

/** The one reason both pointer commands cannot be served, shared so the two texts cannot drift. */
const NO_POINTER =
	"is not available on GTK3 — a cursor belongs to one GdkWindow, not to the app, and GTK has no " +
	"equivalent of +[NSCursor hide] to hide the pointer process-wide";

export function windowChromeAdapter(
	require: (label: string) => bigint,
	sends: WindowSends,
	gate: Refusal,
): WindowChromeNative {
	return {
		setDecorations(label, value) {
			const win = require(label);
			gate("setDecorations", () => sends.setDecorated(win, value));
			const applied = gate("setDecorations", () => sends.decorated(win));
			if (applied !== value) {
				throw new WindowAdapterError(
					"handler-error",
					`crust: window ${JSON.stringify(label)} decorations applied as ${applied}, not ${value}`,
				);
			}
		},
		isDecorated: (label) => gate("isDecorated", () => sends.decorated(require(label))),
		setOpacity(label, value) {
			const win = require(label);
			gate("setOpacity", () => sends.setOpacity(win, value));
			const applied = gate("setOpacity", () => sends.opacity(win));
			if (Math.abs(applied - value) > 1e-9) {
				throw new WindowAdapterError(
					"handler-error",
					`crust: window ${JSON.stringify(label)} opacity applied as ${applied}, not ${value}`,
				);
			}
		},
		opacity: (label) => gate("opacity", () => sends.opacity(require(label))),
		setCursor: () => refuse("setCursor", NO_POINTER),
		setCursorVisible: () => refuse("setCursorVisible", NO_POINTER),
	};
}
