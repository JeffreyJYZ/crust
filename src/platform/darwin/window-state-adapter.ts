/**
 * The labelled half of the state commands: map a label to its `NSWindow *` and keep the two rules AppKit cannot. A fullscreen request is compared with the style mask before `-toggleFullScreen:` is sent, because that selector is a flip and a repeated `setFullscreen(true)` would leave the window. The flag maps to one of two levels and reads back through `-level`, so "on top" is measured.
 * The sends are a parameter so both rules are proved without a window; the real ones are `window-state.ts`.
 */

import type { WindowPoint, WindowSize, WindowStateNative } from "@/plugins/window";
import { WINDOW_LEVEL, type WindowStateSends, windowStateSends } from "./window-state.ts";

export function windowStateAdapter(
	require: (label: string) => number,
	sends: WindowStateSends = windowStateSends,
): WindowStateNative {
	return {
		setSize(label, size) {
			const win = require(label);
			sends.setFrame(win, { ...sends.frame(win), width: size.width, height: size.height });
		},
		getSize(label): WindowSize {
			const frame = sends.frame(require(label));
			return { width: frame.width, height: frame.height };
		},
		setPosition(label, point) {
			const win = require(label);
			sends.setFrame(win, { ...sends.frame(win), x: point.x, y: point.y });
		},
		getPosition(label): WindowPoint {
			const frame = sends.frame(require(label));
			return { x: frame.x, y: frame.y };
		},
		setAlwaysOnTop(label, value) {
			sends.setLevel(require(label), value ? WINDOW_LEVEL.floating : WINDOW_LEVEL.normal);
		},
		// Above normal, not equal to floating: a page that raised the level itself
		// still reads as on top, and a menu-level window is still "on top".
		isAlwaysOnTop: (label) => sends.level(require(label)) > WINDOW_LEVEL.normal,
		setFullscreen(label, value) {
			const win = require(label);
			if (sends.fullscreen(win) !== value) sends.toggleFullscreen(win);
		},
		isFullscreen: (label) => sends.fullscreen(require(label)),
		minimize: (label) => sends.miniaturize(require(label)),
		unminimize: (label) => sends.deminiaturize(require(label)),
		isMinimized: (label) => sends.miniaturized(require(label)),
		maximize: (label) => sends.zoom(require(label)),
		isMaximized: (label) => sends.zoomed(require(label)),
	};
}
