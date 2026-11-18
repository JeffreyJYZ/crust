/**
 * The state half of `crust:window` on Windows: size, position and the two window-level toggles, each
 * one shim call on a handle the caller already resolved. Split from `window-adapter.ts` the way
 * darwin's `window-state-adapter.ts` is, so the six original commands stay one screen.
 *
 * Size and position are the **window rect** — title bar and borders inside the number — because that
 * is what `SetWindowPos` moves, so `setSize` and `getSize` are the same frame rather than two.
 * A `SetWindowPos` that answers 0 is a typed failure naming `GetLastError`, never a silent no-op.
 */
import {
	type WindowPoint,
	WindowAdapterError,
	type WindowSize,
	type WindowStateNative,
} from "@/plugins/window";
import type { WindowsShim } from "./backend.ts";

/** One tracked window, as the six-command adapter resolves it. */
export interface WindowsNativeWindow {
	hwnd: number;
	shim: WindowsShim;
}

/** A frame in Win32 coordinates: origin at the primary display's top-left, `y` growing downward. */
interface Frame {
	x: number;
	y: number;
	width: number;
	height: number;
}

export function windowsWindowStateAdapter(
	require: (label: string) => WindowsNativeWindow,
): WindowStateNative {
	const frameOf = (native: WindowsNativeWindow): Frame => ({
		x: Number(native.shim.shim_window_frame_num(native.hwnd, 0)),
		y: Number(native.shim.shim_window_frame_num(native.hwnd, 1)),
		width: Number(native.shim.shim_window_frame_num(native.hwnd, 2)),
		height: Number(native.shim.shim_window_frame_num(native.hwnd, 3)),
	});

	const setFrame = (native: WindowsNativeWindow, label: string, frame: Frame): void => {
		const { x, y, width, height } = frame;
		if (Number(native.shim.shim_window_set_frame(native.hwnd, x, y, width, height)) === 1)
			return;
		throw new WindowAdapterError(
			"handler-error",
			`crust: window ${JSON.stringify(label)} refused the move ` +
				`(SetWindowPos, GetLastError ${Number(native.shim.shim_last_error())})`,
		);
	};

	/** `ShowWindow` by verb: 0 minimize, 1 maximize, 2 restore. */
	const show = (native: WindowsNativeWindow, label: string, verb: number): void => {
		if (Number(native.shim.shim_window_show(native.hwnd, verb)) === 1) return;
		throw new WindowAdapterError(
			"handler-error",
			`crust: window ${JSON.stringify(label)} refused ShowWindow (verb ${verb})`,
		);
	};

	return {
		// The other axis is read back and preserved, so a resize never moves the window and a move
		// never resizes it — the same rule darwin's `setFrame({ ...frame, … })` keeps.
		setSize(label, size): void {
			const native = require(label);
			setFrame(native, label, { ...frameOf(native), width: size.width, height: size.height });
		},
		getSize(label): WindowSize {
			const { width, height } = frameOf(require(label));
			return { width, height };
		},
		setPosition(label, point): void {
			const native = require(label);
			setFrame(native, label, { ...frameOf(native), x: point.x, y: point.y });
		},
		getPosition(label): WindowPoint {
			const { x, y } = frameOf(require(label));
			return { x, y };
		},
		minimize: (label) => show(require(label), label, 0),
		unminimize: (label) => show(require(label), label, 2),
		isMinimized(label): boolean {
			const native = require(label);
			return Number(native.shim.shim_window_is_minimized(native.hwnd)) === 1;
		},
		maximize: (label) => show(require(label), label, 1),
		isMaximized(label): boolean {
			const native = require(label);
			return Number(native.shim.shim_window_is_maximized(native.hwnd)) === 1;
		},
	};
}
