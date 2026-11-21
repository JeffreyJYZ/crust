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

/** The saved frame a fullscreen window returns to, with the window that owned it. */
interface Saved {
	hwnd: number;
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
	 * Keyed by label — the app's stable name for a window. HWNDs are recycled by Win32, so a record
	 * keyed by hwnd alone survived a close and could restore a dead window's style and frame onto a
	 * new window that reused the handle. A record is also checked against the current hwnd and the
	 * `WS_POPUP` bit before it is trusted; a new window in the normal style drops it instead.
	 */
	const fullscreen = new Map<string, Saved>();

	/** The live record for a label, or undefined — dropping any stale one on the way. */
	const live = (native: WindowsNativeWindow, label: string): Saved | undefined => {
		const saved = fullscreen.get(label);
		if (saved === undefined) return undefined;
		if (saved.hwnd !== native.hwnd || (styleOf(native, label) & POPUP) === 0) {
			fullscreen.delete(label);
			return undefined;
		}
		return saved;
	};

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
			if (value) {
				if (live(native, label) !== undefined) return;
				const style = styleOf(native, label);
				fullscreen.set(label, {
					hwnd: native.hwnd,
					style,
					frame: frameOf(native, label),
				});
				const monitor = monitorOf(native, label);
				writeStyle(native, label, (style & ~FRAME_BITS) | POPUP);
				setFrame(native, label, monitor);
				return;
			}
			const saved = live(native, label);
			if (saved === undefined) return;
			writeStyle(native, label, saved.style);
			setFrame(native, label, saved.frame);
			fullscreen.delete(label);
		},
		isFullscreen(label): boolean {
			return live(require(label), label) !== undefined;
		},
	};
}
