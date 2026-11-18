/**
 * `window.setFullscreen` / `window.isFullscreen` on Windows: a saved style and frame, `WS_POPUP`, and
 * the monitor the window is on.
 *
 * Split from `window-style-adapter.ts` because it is the one style member that keeps state: entering
 * saves the style and the window rect, leaving puts both back, and `isFullscreen` is "a record exists
 * and the style still carries `WS_POPUP`". That last half is what makes it a read rather than a flag —
 * a style someone else rewrote reads as "not fullscreen", and the record is deleted only after the
 * restore succeeded, so a refused `SetWindowPos` can be retried instead of losing the frame.
 */
import { WindowAdapterError } from "@/plugins/window";
import type { WindowsNativeWindow } from "./window-state-adapter.ts";
import { frameOf, setFrame, styleOf, writeStyle } from "./window-style-calls.ts";

/** `WS_OVERLAPPEDWINDOW`: the five bits a titled, resizable frame is. */
const FRAME_BITS = 0x00cf0000;
/** `WS_POPUP`, the bit a borderless fullscreen window carries. */
const POPUP = 0x80000000;

/** The saved frame a fullscreen window returns to. */
interface Saved {
	style: number;
	frame: [number, number, number, number];
}

export interface WindowsFullscreenNative {
	setFullscreen(label: string, value: boolean): void;
	isFullscreen(label: string): boolean;
}

export function windowsFullscreenAdapter(
	require: (label: string) => WindowsNativeWindow,
): WindowsFullscreenNative {
	/**
	 * Keyed by hwnd. `isFullscreen` requires both the record and the popup bit, so a record left
	 * behind by a closed window cannot answer for a new one: a reused handle in the normal style has
	 * no popup bit.
	 */
	const fullscreen = new Map<number, Saved>();

	/** The monitor the window is on, as the rect fullscreen should cover. */
	const monitorOf = (native: WindowsNativeWindow, label: string): number[] => {
		const rect = [0, 1, 2, 3].map((component) =>
			Number(native.shim.shim_window_monitor_num(native.hwnd, component)),
		);
		// A monitor rect of no area is `MonitorFromWindow` or `GetMonitorInfoW` refusing, and a
		// fullscreen move to 0×0 would hide the window rather than cover a display.
		if ((rect[2] ?? 0) <= 0 || (rect[3] ?? 0) <= 0) {
			throw new WindowAdapterError(
				"handler-error",
				`crust: window ${JSON.stringify(label)} has no monitor rect to fill ` +
					"(MonitorFromWindow or GetMonitorInfoW failed)",
			);
		}
		return rect;
	};

	return {
		/**
		 * Enter: save the style and frame, drop `WS_OVERLAPPEDWINDOW` for `WS_POPUP` and fill the
		 * monitor. Leave: put the saved style and frame back, in that order, because the style write is
		 * what repaints the frame.
		 */
		setFullscreen(label, value): void {
			const native = require(label);
			const hwnd = native.hwnd;
			const saved = fullscreen.get(hwnd);
			if (value) {
				if (saved !== undefined && (styleOf(native, label) & POPUP) !== 0) return;
				const style = styleOf(native, label);
				fullscreen.set(hwnd, { style, frame: frameOf(native, label) });
				const monitor = monitorOf(native, label);
				writeStyle(native, label, (style & ~FRAME_BITS) | POPUP);
				setFrame(native, label, monitor);
				return;
			}
			if (saved === undefined) return;
			writeStyle(native, label, saved.style);
			setFrame(native, label, saved.frame);
			fullscreen.delete(hwnd);
		},
		isFullscreen(label): boolean {
			const native = require(label);
			if (fullscreen.get(native.hwnd) === undefined) return false;
			return (styleOf(native, label) & POPUP) !== 0;
		},
	};
}
