/**
 * The style, placement and pointer members of the fake shim, split out of `fake-shim.ts` when that
 * file reached the line cap.
 *
 * These members keep a record **per hwnd** rather than the single `frame` array `fake-shim.ts` holds,
 * because the point of each one is that the operating system owns the state: a test has to be able to
 * tell a read-back from a value the adapter remembered. `set_decorated` therefore writes the style the
 * way `SetWindowLongPtrW` does, and `is_decorated` answers from the style, so a toggle that never
 * reached the fake reads back as the old value instead of as the request.
 */
import type { WindowsShim } from "./backend.ts";
import type { FakeOptions } from "./fake-backend.ts";

/** `WS_OVERLAPPEDWINDOW`: what `CreateWindowExW` gives every crust window. */
export const FAKE_OVERLAPPED = 0x00cf0000;
/** `WS_CAPTION`, the bit `isDecorated` reads. */
export const FAKE_CAPTION = 0x00c00000;
/** `WS_POPUP`, the bit `isFullscreen` reads back. */
export const FAKE_POPUP = 0x80000000;
const EX_TOPMOST = 0x00000008;
const EX_LAYERED = 0x00080000;
/** The monitor every fake window is on: 0, 0, 1920×1080. */
const MONITOR = [0, 0, 1920, 1080];

interface StyleState {
	style: number;
	exstyle: number;
	alpha: number;
}

/** The members this module supplies; `fake-shim.ts` spreads them into the whole table. */
export type FakeStyleShim = Pick<
	WindowsShim,
	| "shim_window_set_topmost"
	| "shim_window_is_topmost"
	| "shim_window_set_decorated"
	| "shim_window_is_decorated"
	| "shim_window_set_alpha"
	| "shim_window_alpha"
	| "shim_window_style"
	| "shim_window_set_style"
	| "shim_window_monitor_num"
	| "shim_cursor_set"
	| "shim_cursor_show"
>;

export function fakeWindowStyle(calls: string[], options: FakeOptions = {}): FakeStyleShim {
	const windows = new Map<number, StyleState>();
	const state = (hwnd: number): StyleState => {
		const known = windows.get(hwnd);
		if (known !== undefined) return known;
		const fresh: StyleState = {
			style: FAKE_OVERLAPPED,
			exstyle: 0,
			alpha: 255,
		};
		windows.set(hwnd, fresh);
		return fresh;
	};

	return {
		shim_window_set_topmost: (hwnd, on) => {
			calls.push(`topmost:${Number(on)}`);
			if (options.failTopmost) return 0;
			const entry = state(Number(hwnd));
			entry.exstyle =
				(Number(on) === 1 ? entry.exstyle | EX_TOPMOST : entry.exstyle & ~EX_TOPMOST) | 0;
			return 1;
		},
		shim_window_is_topmost: (hwnd) => (state(Number(hwnd)).exstyle & EX_TOPMOST ? 1 : 0),

		shim_window_set_decorated: (hwnd, on) => {
			calls.push(`decorated:${Number(on)}`);
			if (options.failStyle) return 0;
			const entry = state(Number(hwnd));
			entry.style =
				(Number(on) === 1
					? entry.style | FAKE_OVERLAPPED
					: entry.style & ~FAKE_OVERLAPPED) | 0;
			const decorated = (entry.style & FAKE_CAPTION) !== 0;
			return decorated === (Number(on) === 1) ? 1 : 0;
		},
		shim_window_is_decorated: (hwnd) => (state(Number(hwnd)).style & FAKE_CAPTION ? 1 : 0),

		shim_window_set_alpha: (hwnd, alpha) => {
			const value = Math.max(0, Math.min(255, Math.round(Number(alpha))));
			calls.push(`alpha:${value}`);
			if (options.failAlpha) return 0;
			const entry = state(Number(hwnd));
			entry.exstyle = entry.exstyle | EX_LAYERED | 0;
			entry.alpha = value;
			return 1;
		},
		// Not layered is fully opaque, which is a fact; a layered window answers the alpha it holds.
		shim_window_alpha: (hwnd) => {
			const entry = state(Number(hwnd));
			return entry.exstyle & EX_LAYERED ? entry.alpha : 255;
		},

		shim_window_style: (hwnd, out) => {
			out[0] = state(Number(hwnd)).style;
			return 1;
		},
		shim_window_set_style: (hwnd, style) => {
			calls.push(`style:${Number(style)}`);
			if (options.failStyle) return 0;
			state(Number(hwnd)).style = Number(style) | 0;
			return 1;
		},

		shim_window_monitor_num: (_hwnd, component) => {
			calls.push(`monitor:${Number(component)}`);
			return MONITOR[Number(component)] ?? 0;
		},

		shim_cursor_set: (kind) => {
			calls.push(`cursor:${Number(kind)}`);
			return options.failCursor ? 0 : 1;
		},
		// The count `ShowCursor` would answer: >= 0 is visible. A refused call answers the *other*
		// side, so the adapter's own check is what a test sees fail.
		shim_cursor_show: (visible) => {
			const wanted = Number(visible) === 1;
			calls.push(`cursor_show:${wanted ? 1 : 0}`);
			if (options.failCursor) return wanted ? -1 : 0;
			return wanted ? 0 : -1;
		},
	};
}
