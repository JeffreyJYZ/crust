/**
 * The labelled half of the chrome commands: map a label to its `NSWindow *` and keep the rule AppKit does not. `-setStyleMask:` moves the window's frame — adding a title bar grows it upward — so the frame is read first, re-applied when it moved, and read back to prove it took. A frame that cannot be read is refused before the mask is touched, because then a toggle could not be undone.
 * The sends are a parameter so the rule is proved without a window; the real ones are `window-chrome.ts`.
 */

import type { WindowChromeNative } from "@/plugins/window";
import { WindowAdapterError } from "@/plugins/window";
import type { WindowChromeSends } from "./window-chrome.ts";
import { windowChromeSends } from "./window-chrome.ts";
import type { WindowFrame } from "./window-state.ts";

/** `NSWindowStyleMaskTitled|Closable|Miniaturizable`, the trio a title bar is. */
export const TITLE_BAR_MASK = 0b111;

/** `NSWindowStyleMaskTitled` alone: what `isDecorated` reads. */
const TITLED = 0b1;

export function windowChromeAdapter(
	require: (label: string) => number,
	sends: WindowChromeSends = windowChromeSends,
): WindowChromeNative {
	// AppKit's +hide/+unhide is a counter, not a flag: two hides need two unhides. The
	// command is a setter, so a repeat must be a no-op and two false then one true must
	// leave the pointer visible. Remember the requested side and send only transitions.
	let cursorVisible = true;
	return {
		setDecorations(label, value) {
			const win = require(label);
			const before = sends.frame(win);
			// Refused before the mask is sent: a frame we cannot restore is a
			// window left the wrong size with no way back.
			if (!readable(before)) {
				throw new WindowAdapterError(
					"handler-error",
					`crust: window ${JSON.stringify(label)} decorations were not changed — ` +
						"its frame could not be read, so a title-bar toggle could not be undone",
				);
			}
			const mask = sends.styleMask(win);
			const next = value ? mask | TITLE_BAR_MASK : mask & ~TITLE_BAR_MASK;
			if (next === mask) return;
			sends.setStyleMask(win, next);
			// AppKit usually resizes here; when it did not, the frame is already
			// right and a setFrame: would only cost a redraw.
			if (sameFrame(before, sends.frame(win))) return;
			sends.setFrame(win, before);
			if (!sameFrame(before, sends.frame(win))) {
				throw new WindowAdapterError(
					"handler-error",
					`crust: window ${JSON.stringify(label)} style mask was set but its frame ` +
						"was not restored; the window is now a different size than before",
				);
			}
		},
		isDecorated: (label) => (sends.styleMask(require(label)) & TITLED) !== 0,
		// Read back, so an AppKit that ignored the value is an error rather than a
		// success: same rule `setTitle` follows.
		setOpacity(label, value) {
			const win = require(label);
			sends.setOpacity(win, value);
			const applied = sends.opacity(win);
			if (Math.abs(applied - value) > 1e-9) {
				throw new WindowAdapterError(
					"handler-error",
					`crust: window ${JSON.stringify(label)} opacity applied as ${applied}, not ${value}`,
				);
			}
		},
		opacity: (label) => sends.opacity(require(label)),
		setCursor: (cursor) => sends.cursor(cursor),
		setCursorVisible: (visible) => {
			if (visible === cursorVisible) return;
			sends.cursorVisible(visible);
			cursorVisible = visible;
		},
	};
}

/** A frame the caller can put back: four finite numbers and a real area. */
function readable(frame: WindowFrame): boolean {
	const values = [frame.x, frame.y, frame.width, frame.height];
	return values.every((value) => Number.isFinite(value)) && frame.width > 0 && frame.height > 0;
}

/** Exact, because it compares a value just written with what AppKit reports. */
function sameFrame(left: WindowFrame, right: WindowFrame): boolean {
	return (
		left.x === right.x &&
		left.y === right.y &&
		left.width === right.width &&
		left.height === right.height
	);
}
