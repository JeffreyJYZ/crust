/**
 * The four shim calls the style members share, so `window-style-adapter.ts` and
 * `window-fullscreen-adapter.ts` do not each grow their own copy of the error text.
 *
 * Every one throws `handler-error` naming the Win32 call that answered 0, because a style or frame
 * this layer cannot read is a refusal, not a default: a member that guessed would report a value the
 * window does not have.
 */
import { WindowAdapterError } from "@/plugins/window";
import type { WindowsNativeWindow } from "./window-state-adapter.ts";

/** `GWL_STYLE`, read back. */
export function styleOf(native: WindowsNativeWindow, label: string): number {
	const out = new Int32Array(1);
	if (Number(native.shim.shim_window_style(native.hwnd, out)) !== 1) {
		throw new WindowAdapterError(
			"handler-error",
			`crust: window ${JSON.stringify(label)} has no style to read (GetWindowLongPtrW failed)`,
		);
	}
	return out[0] ?? 0;
}

/** Write `GWL_STYLE` and let the shim prove it took by reading it back. */
export function writeStyle(native: WindowsNativeWindow, label: string, style: number): void {
	if (Number(native.shim.shim_window_set_style(native.hwnd, style | 0)) === 1) return;
	throw new WindowAdapterError(
		"handler-error",
		`crust: window ${JSON.stringify(label)} refused the style ` +
			`(SetWindowLongPtrW, GetLastError ${Number(native.shim.shim_last_error())})`,
	);
}

/** The window rect as four numbers, or a failure — never a 0×0 frame for a closed handle. */
export function frameOf(
	native: WindowsNativeWindow,
	label: string,
): [number, number, number, number] {
	const out = new Int32Array(4);
	if (Number(native.shim.shim_window_frame(native.hwnd, out)) !== 1) {
		throw new WindowAdapterError(
			"handler-error",
			`crust: window ${JSON.stringify(label)} has no frame to read (GetWindowRect failed)`,
		);
	}
	return [out[0] ?? 0, out[1] ?? 0, out[2] ?? 0, out[3] ?? 0];
}

/** `SetWindowPos` through the shim, with the OS's own error beside a refusal. */
export function setFrame(native: WindowsNativeWindow, label: string, frame: number[]): void {
	const [x, y, width, height] = frame as [number, number, number, number];
	if (Number(native.shim.shim_window_set_frame(native.hwnd, x, y, width, height)) === 1) return;
	throw new WindowAdapterError(
		"handler-error",
		`crust: window ${JSON.stringify(label)} refused the move ` +
			`(SetWindowPos, GetLastError ${Number(native.shim.shim_last_error())})`,
	);
}
