/**
 * The state half of `crust:window` on Windows: size, position and the four window-level toggles, each
 * one shim call on a handle the caller already resolved. Split from `window-adapter.ts` the way
 * darwin's `window-state-adapter.ts` is, so the original commands stay one screen.
 *
 * Size and position are the **window rect** — title bar and borders inside the number — because that
 * is what `SetWindowPos` moves, so `setSize` and `getSize` are the same frame rather than two.
 *
 * **A minimised or maximised window is read from its restore rect.** `GetWindowRect` answers the
 * iconic off-screen rect for a minimised window (classically -32000,-32000) and the whole monitor for
 * a maximised one, so a `window-state.save` in either state would persist a frame nobody can find on
 * the next `restore`. `WINDOWPLACEMENT.rcNormalPosition` is the rect the window returns to, which is
 * the one a caller means. Writes start from that same rect while minimised, so `setSize` cannot move
 * a minimised window to -32000.
 */
import {
	WindowAdapterError,
	type WindowPoint,
	type WindowSize,
	type WindowStateNative,
} from "@/plugins/window";
import type { WindowsShim } from "./backend.ts";

/** One tracked window, as the adapter resolves it. */
export interface WindowsNativeWindow {
	hwnd: number;
	shim: WindowsShim;
}

/** A frame in Win32 coordinates: origin at the primary display's top-left, `y` growing downward. */
export interface Frame {
	x: number;
	y: number;
	width: number;
	height: number;
}

/** The four components an `Int32Array(4)` carries, once a shim call has written them. */
function frameFrom(out: Int32Array): Frame {
	return {
		x: out[0] ?? 0,
		y: out[1] ?? 0,
		width: out[2] ?? 0,
		height: out[3] ?? 0,
	};
}

export function windowsWindowStateAdapter(
	require: (label: string) => WindowsNativeWindow,
): WindowStateNative {
	/**
	 * The window rect, or a typed failure. `shim_window_frame` answers 0 when `GetWindowRect` failed,
	 * which is the only way a closed handle is told from a 0×0 window: a component of 0 is a legal
	 * coordinate, so a per-component read answered `{ width: 0, height: 0 }` for both.
	 */
	const frameOf = (native: WindowsNativeWindow, label: string): Frame => {
		const out = new Int32Array(4);
		if (Number(native.shim.shim_window_frame(native.hwnd, out)) !== 1) {
			throw new WindowAdapterError(
				"handler-error",
				`crust: window ${JSON.stringify(label)} has no frame to read (GetWindowRect failed)`,
			);
		}
		return frameFrom(out);
	};

	/** `WINDOWPLACEMENT.rcNormalPosition`: where the window goes when it stops being minimised. */
	const normalFrameOf = (native: WindowsNativeWindow, label: string): Frame => {
		const out = new Int32Array(4);
		if (Number(native.shim.shim_window_normal_frame(native.hwnd, out)) !== 1) {
			throw new WindowAdapterError(
				"handler-error",
				`crust: window ${JSON.stringify(label)} has no restore frame to read ` +
					"(GetWindowPlacement failed)",
			);
		}
		return frameFrom(out);
	};

	const isMinimized = (native: WindowsNativeWindow): boolean =>
		Number(native.shim.shim_window_is_minimized(native.hwnd)) === 1;
	const isMaximized = (native: WindowsNativeWindow): boolean =>
		Number(native.shim.shim_window_is_maximized(native.hwnd)) === 1;

	/**
	 * What a read reports: `rcNormalPosition` while the window is minimised **or** maximised, the
	 * window rect otherwise. A maximised window's own rect is the whole monitor, so reporting it would
	 * make `window-state.save` persist a full-screen frame and the next `restore` reopen the window at
	 * monitor size instead of the size the user had chosen. `isMaximized` says which state it is in.
	 */
	const readFrame = (native: WindowsNativeWindow, label: string): Frame =>
		isMinimized(native) || isMaximized(native)
			? normalFrameOf(native, label)
			: frameOf(native, label);

	/**
	 * The frame a write starts from: the restore rect while minimised, so `setSize` cannot move an
	 * off-screen window to -32000, and the window rect otherwise — `SetWindowPos` on a maximised
	 * window keeps it maximised, so its own rect is the one that answers.
	 */
	const writeBase = (native: WindowsNativeWindow, label: string): Frame =>
		isMinimized(native) ? normalFrameOf(native, label) : frameOf(native, label);

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
			setFrame(native, label, {
				...writeBase(native, label),
				width: size.width,
				height: size.height,
			});
		},
		getSize(label): WindowSize {
			const { width, height } = readFrame(require(label), label);
			return { width, height };
		},
		setPosition(label, point): void {
			const native = require(label);
			setFrame(native, label, {
				...writeBase(native, label),
				x: point.x,
				y: point.y,
			});
		},
		getPosition(label): WindowPoint {
			const { x, y } = readFrame(require(label), label);
			return { x, y };
		},
		minimize: (label) => show(require(label), label, 0),
		/**
		 * `SW_RESTORE` on a window that is not minimised also un-maximises it: Win32 documents it as
		 * "restores the window to its original size and position", so `maximize()` then `unminimize()`
		 * used to answer `ok` while silently losing the maximised size. A window that is not minimised
		 * has nothing to un-minimise, so the call is not made at all.
		 */
		unminimize(label): void {
			const native = require(label);
			if (!isMinimized(native)) return;
			show(native, label, 2);
		},
		isMinimized: (label) => isMinimized(require(label)),
		maximize: (label) => show(require(label), label, 1),
		isMaximized: (label) => isMaximized(require(label)),
	};
}
