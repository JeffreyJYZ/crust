/**
 * The state commands' AppKit sends, one per selector. Kept apart from the labelled adapter so the rules that are not AppKit's — a fullscreen toggle is a flip, the flag maps to one of two levels — are testable with these replaced by a double.
 */

import { shim } from "./index.ts";

/** A window frame in AppKit's screen coordinates: bottom-left origin, points. */
export interface WindowFrame {
	x: number;
	y: number;
	width: number;
	height: number;
}

/** The seam `windowStateAdapter` reads, so its rules run without a window. */
export interface WindowStateSends {
	frame(win: number): WindowFrame;
	setFrame(win: number, frame: WindowFrame): void;
	level(win: number): number;
	setLevel(win: number, level: number): void;
	fullscreen(win: number): boolean;
	toggleFullscreen(win: number): void;
	zoomed(win: number): boolean;
	zoom(win: number): void;
	miniaturized(win: number): boolean;
	miniaturize(win: number): void;
	deminiaturize(win: number): void;
}

/**
 * `NSNormalWindowLevel` and `NSFloatingWindowLevel`. Floating is what "always on
 * top" means on macOS: a window above its own app's windows, still below menus.
 */
export const WINDOW_LEVEL = { normal: 0, floating: 3 } as const;

/** The real sends. Each reads `shim()` lazily, so importing this compiles nothing. */
export const windowStateSends: WindowStateSends = {
	frame(win) {
		const symbols = shim().symbols;
		return {
			x: Number(symbols.shim_window_frame_num(win, 0) ?? 0),
			y: Number(symbols.shim_window_frame_num(win, 1) ?? 0),
			width: Number(symbols.shim_window_frame_num(win, 2) ?? 0),
			height: Number(symbols.shim_window_frame_num(win, 3) ?? 0),
		};
	},
	setFrame(win, frame) {
		shim().symbols.shim_window_set_frame(win, frame.x, frame.y, frame.width, frame.height);
	},
	level: (win) => Number(shim().symbols.shim_window_level(win) ?? 0),
	setLevel: (win, level) => {
		shim().symbols.shim_window_set_level(win, level);
	},
	fullscreen: (win) => Number(shim().symbols.shim_window_is_fullscreen(win) ?? 0) === 1,
	toggleFullscreen: (win) => {
		shim().symbols.shim_window_toggle_fullscreen(win);
	},
	zoomed: (win) => Number(shim().symbols.shim_window_is_zoomed(win) ?? 0) === 1,
	zoom: (win) => {
		shim().symbols.shim_window_zoom(win);
	},
	miniaturized: (win) => Number(shim().symbols.shim_window_is_miniaturized(win) ?? 0) === 1,
	miniaturize: (win) => {
		shim().symbols.shim_window_miniaturize(win);
	},
	deminiaturize: (win) => {
		shim().symbols.shim_window_deminiaturize(win);
	},
};
