/**
 * The chrome commands' AppKit sends, one per selector. Kept apart from the labelled adapter so the rules that are not AppKit's — the frame re-applied after a style-mask change, an opacity read back — are testable with these replaced by a double.
 */

import type { WindowCursor } from "@/plugins/window";
import { cls, S } from "./objc.ts";
import { shim } from "./index.ts";
import { type WindowFrame, windowStateSends } from "./window-state.ts";

/** The seam `windowChromeAdapter` reads, so its rules run without a window. */
export interface WindowChromeSends {
	frame(win: number): WindowFrame;
	setFrame(win: number, frame: WindowFrame): void;
	styleMask(win: number): number;
	setStyleMask(win: number, mask: number): void;
	opacity(win: number): number;
	setOpacity(win: number, value: number): void;
	cursor(cursor: WindowCursor): void;
	cursorVisible(visible: boolean): void;
}

/**
 * The cursor names, each one `NSCursor` class method. `text` is `IBeamCursor`
 * and `grab` is the open hand: the two names a page says, the two selectors
 * AppKit answers.
 */
export const CURSOR_SELECTOR: Readonly<Record<WindowCursor, string>> = {
	default: "arrowCursor",
	pointer: "pointingHandCursor",
	crosshair: "crosshairCursor",
	text: "IBeamCursor",
	grab: "openHandCursor",
};

/** The real sends. Each reads `shim()` lazily, so importing this compiles nothing. */
export const windowChromeSends: WindowChromeSends = {
	frame: (win) => windowStateSends.frame(win),
	setFrame: (win, frame) => {
		windowStateSends.setFrame(win, frame);
	},
	styleMask: (win) => S.q0(win, "styleMask"),
	setStyleMask: (win, mask) => {
		S.vq1(win, "setStyleMask:", mask);
	},
	opacity: (win) => Number(shim().symbols.shim_window_opacity(win) ?? 1),
	setOpacity: (win, value) => {
		shim().symbols.shim_window_set_opacity(win, value);
	},
	cursor: (cursor) => {
		S.v0(S.p0(cls("NSCursor"), CURSOR_SELECTOR[cursor], true), "set");
	},
	// One of the pair per request, sent from C: the receiver is the class object,
	// and AppKit also resets the cursor on the next mouse move, so this holds for
	// the current pointer position rather than as a lasting setting.
	cursorVisible: (visible) => {
		shim().symbols.shim_cursor_visible(visible ? 1 : 0);
	},
};
