/**
 * The native calls the `crust:window` adapter makes, as one seam, and the single place
 * `unknown-adapter` is raised. Every member answers `undefined` when GTK cannot do the thing — an
 * entry point that did not resolve, a display that cannot place a toplevel, a window GDK has not
 * allocated yet — and `refusalGate` turns that into a `WindowAdapterError` naming the command.
 * Nothing here invents a value: an unanswerable read is absent, never zero, `false` or the last
 * thing written, because a plausible fake is what makes a caller believe a command worked.
 * The real table is `gtkWindowSends`; a test passes its own and never loads GTK.
 */
import { WindowAdapterError, type WindowPoint, type WindowSize } from "@/plugins/window";
import { cstring } from "./cstring.ts";
import { type LinuxShim, shim } from "./shim-ffi.ts";

/** GdkWindowState bits (gdk/gdkwindow.h), the only GTK3 readback for these three flags. */
export const GDK_STATE = {
	iconified: 1 << 1,
	maximized: 1 << 2,
	fullscreen: 1 << 4,
	above: 1 << 5,
} as const;

/** The flag triples `shim_window_flag` numbers. */
export type WindowFlag = "iconified" | "maximized" | "fullscreen";

const FLAG_NUMBER: Record<WindowFlag, number> = { iconified: 0, maximized: 1, fullscreen: 2 };

/** Every native answer the adapter needs; `undefined` means "GTK cannot say", never "no". */
export interface WindowSends {
	present(win: bigint): true | undefined;
	setTitle(win: bigint, title: string): true | undefined;
	title(win: bigint): string | undefined;
	resize(win: bigint, size: WindowSize): true | undefined;
	size(win: bigint): WindowSize | undefined;
	/** Whether this display honours a client-side move at all. */
	placeable(): boolean;
	move(win: bigint, point: WindowPoint): true | undefined;
	position(win: bigint): WindowPoint | undefined;
	setFlag(win: bigint, flag: WindowFlag, on: boolean): true | undefined;
	/** The GdkWindowState word, or absent before the widget has a GdkWindow. */
	state(win: bigint): number | undefined;
	keepAbove(win: bigint, on: boolean): true | undefined;
	setDecorated(win: bigint, on: boolean): true | undefined;
	decorated(win: bigint): boolean | undefined;
	setOpacity(win: bigint, value: number): true | undefined;
	opacity(win: bigint): number | undefined;
	/** The entry point that did not resolve, for the refusal's own text. */
	missing(): string;
}

/** One boolean-returning entry point as "done" or "GTK could not". */
function done(value: number | undefined): true | undefined {
	return Number(value ?? 0) === 1 ? true : undefined;
}

export function gtkWindowSends(native: LinuxShim = shim().symbols): WindowSends {
	const missing = (): string => String(native.shim_window_api_missing?.() ?? "");
	return {
		present: (win) => done(native.shim_window_present?.(win)),
		setTitle: (win, title) => done(native.shim_window_set_title?.(win, cstring(title))),
		title: (win) => {
			const applied = native.shim_window_title?.(win);
			return typeof applied === "string" ? applied : undefined;
		},
		resize: (win, size) => done(native.shim_window_resize?.(win, size.width, size.height)),
		size: (win) => {
			const out = new Int32Array(2);
			if (!done(native.shim_window_size?.(win, out))) return undefined;
			return { width: out[0] ?? 0, height: out[1] ?? 0 };
		},
		placeable: () => Number(native.shim_window_placeable?.() ?? 0) === 1,
		move: (win, point) => done(native.shim_window_move?.(win, point.x, point.y)),
		position: (win) => {
			const out = new Int32Array(2);
			if (!done(native.shim_window_position?.(win, out))) return undefined;
			return { x: out[0] ?? 0, y: out[1] ?? 0 };
		},
		setFlag: (win, flag, on) =>
			done(native.shim_window_flag?.(win, FLAG_NUMBER[flag], on ? 1 : 0)),
		state: (win) => {
			const value = Number(native.shim_window_state?.(win) ?? -1);
			return value < 0 ? undefined : value;
		},
		keepAbove: (win, on) => done(native.shim_window_keep_above?.(win, on ? 1 : 0)),
		setDecorated: (win, on) => done(native.shim_window_set_decorated?.(win, on ? 1 : 0)),
		decorated: (win) => {
			const value = Number(native.shim_window_decorated?.(win) ?? -1);
			return value < 0 ? undefined : value === 1;
		},
		setOpacity: (win, value) => done(native.shim_widget_set_opacity?.(win, value)),
		opacity: (win) => {
			const value = Number(native.shim_widget_opacity?.(win) ?? -1);
			return Number.isFinite(value) && value >= 0 ? value : undefined;
		},
		missing,
	};
}

/** Run a native answer, or refuse the named command: the one `unknown-adapter` site. */
export type Refusal = <T>(member: string, run: () => T | undefined) => T;

export function refusalGate(sends: Pick<WindowSends, "missing">): Refusal {
	return (member, run) => {
		const value = run();
		if (value !== undefined) return value;
		const absent = sends.missing();
		throw new WindowAdapterError(
			"unknown-adapter",
			`crust: window.${member} is not available on GTK3 — ${
				absent ? `${absent} did not resolve` : "GTK could not answer for this window"
			}`,
		);
	};
}

/** Refuse one command outright, naming the GTK gap rather than faking an answer. */
export function refuse(member: string, why: string): never {
	throw new WindowAdapterError("unknown-adapter", `crust: window.${member} ${why}`);
}
