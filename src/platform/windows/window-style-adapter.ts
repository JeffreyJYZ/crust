/**
 * The style-driven half of `crust:window` on Windows: always-on-top, decorations and opacity. Split
 * from `window-adapter.ts` because four pairs would break that file's line cap, and from
 * `window-fullscreen-adapter.ts` because fullscreen is the one member that keeps state.
 *
 * **Nothing here is remembered instead of read.** Always-on-top is `WS_EX_TOPMOST` out of
 * `GWL_EXSTYLE`, decorations are `WS_CAPTION` out of `GWL_STYLE`, and opacity is
 * `GetLayeredWindowAttributes`' alpha, so a call Windows refused reads back as the old value rather
 * than as the value the page asked for.
 *
 * **`GetWindowLongPtrW`, never `GetWindowLongW`.** The style is a 32-bit `DWORD` but the call that
 * reads it is pointer-sized at x64 and arm64, and the 32-bit call truncates it.
 */
import type { WindowChromeNative } from "@/plugins/window";
import { WindowAdapterError } from "@/plugins/window";
import type { WindowsNativeWindow } from "./window-state-adapter.ts";
import { styleOf } from "./window-style-calls.ts";

/** `WS_CAPTION` alone, which is what `isDecorated` reads. */
const CAPTION = 0x00c00000;

/** The three members this module supplies; `windowsWindowStyleAdapter` adds them to the rest. */
export interface WindowsStyleNative extends WindowChromeNative {
	setAlwaysOnTop(label: string, value: boolean): void;
	isAlwaysOnTop(label: string): boolean;
}

export function windowsWindowStyleAdapter(
	require: (label: string) => WindowsNativeWindow,
): WindowsStyleNative {
	return {
		setAlwaysOnTop(label, value): void {
			const native = require(label);
			if (Number(native.shim.shim_window_set_topmost(native.hwnd, value ? 1 : 0)) === 1)
				return;
			throw new WindowAdapterError(
				"handler-error",
				`crust: window ${JSON.stringify(label)} refused always-on-top ` +
					`(SetWindowPos, GetLastError ${Number(native.shim.shim_last_error())})`,
			);
		},
		isAlwaysOnTop(label): boolean {
			const native = require(label);
			return Number(native.shim.shim_window_is_topmost(native.hwnd)) === 1;
		},

		setDecorations(label, value): void {
			const native = require(label);
			if (Number(native.shim.shim_window_set_decorated(native.hwnd, value ? 1 : 0)) === 1)
				return;
			throw new WindowAdapterError(
				"handler-error",
				`crust: window ${JSON.stringify(label)} refused the decoration change ` +
					`(SetWindowLongPtrW, GetLastError ${Number(native.shim.shim_last_error())})`,
			);
		},
		isDecorated(label): boolean {
			const native = require(label);
			return (styleOf(native, label) & CAPTION) !== 0;
		},

		/**
		 * An alpha is 8 bits, so `setOpacity(0.5)` applies as 128/255 and `opacity()` answers 0.50196:
		 * the number Windows holds, not the number the page asked for. The check compares the applied
		 * integer, which is the exact value rather than a floating-point near-miss.
		 */
		setOpacity(label, value): void {
			const native = require(label);
			const alpha = Math.round(Math.min(1, Math.max(0, value)) * 255);
			if (Number(native.shim.shim_window_set_alpha(native.hwnd, alpha)) !== 1) {
				throw new WindowAdapterError(
					"handler-error",
					`crust: window ${JSON.stringify(label)} refused the alpha ` +
						`(SetLayeredWindowAttributes, GetLastError ` +
						`${Number(native.shim.shim_last_error())})`,
				);
			}
			const applied = Number(native.shim.shim_window_alpha(native.hwnd));
			if (applied !== alpha) {
				throw new WindowAdapterError(
					"handler-error",
					`crust: window ${JSON.stringify(label)} opacity applied as ${applied}/255, ` +
						`not ${alpha}/255`,
				);
			}
		},
		opacity(label): number {
			const native = require(label);
			const alpha = Number(native.shim.shim_window_alpha(native.hwnd));
			if (alpha < 0) {
				throw new WindowAdapterError(
					"handler-error",
					`crust: window ${JSON.stringify(label)} has no alpha to read ` +
						"(GetLayeredWindowAttributes failed)",
				);
			}
			return alpha / 255;
		},
	};
}
