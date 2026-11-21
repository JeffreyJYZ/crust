/**
 * The fake shim the Linux window adapter is proved against. There is no GTK on the machine this was
 * written on, so the FFI table is the only thing a test can measure: it answers from recorded state,
 * records every argument, and can be told to behave like a library whose entry point never resolved
 * (`missing`), a display that cannot place a window (`placeable: false`), a widget GDK has not
 * realised yet (`realised: false`), or a GTK that accepted a call and ignored it (`ignoring`).
 * Windows are numbers the fake hands out, the same trick `backend.test.ts` uses for pointers.
 */
import { createGtkBackend } from "./backend.ts";
import { uncstring } from "./cstring.ts";
import { LinuxPlatform } from "./platform.ts";
import type { LinuxShim } from "./shim-ffi.ts";

export interface FakeOptions {
	/** false models Wayland: no client-side placement and no origin to read back. */
	placeable?: boolean;
	/** The entry point that did not resolve, as `shim_window_api_missing` reports it. */
	missing?: string;
	/** false models a window GDK has not allocated yet: `shim_window_state` answers -1. */
	realised?: boolean;
}

export interface FakeShim {
	symbols: LinuxShim;
	calls: string[];
	titles: Map<number, string>;
	sizes: Map<number, { width: number; height: number }>;
	positions: Map<number, { x: number; y: number }>;
	states: Map<number, number>;
	decorated: Map<number, boolean>;
	opacity: Map<number, number>;
	/** Every URL the fake webview was asked to load, decoded. */
	urls: string[];
	/** Member names a "healthy" GTK accepts and silently drops, which the read-back must catch. */
	ignoring: Set<string>;
}

export function fakeWindowShim(options: FakeOptions = {}): FakeShim {
	const calls: string[] = [];
	const live = new Set<number>();
	let next = 100;
	const titles = new Map<number, string>();
	const sizes = new Map<number, { width: number; height: number }>();
	const positions = new Map<number, { x: number; y: number }>();
	const states = new Map<number, number>();
	const decorated = new Map<number, boolean>();
	const opacity = new Map<number, number>();
	const urls: string[] = [];
	const ignoring = new Set<string>();
	const ready = options.missing === undefined ? 1 : 0;
	const placeable = options.placeable ?? true;
	const realised = options.realised ?? true;
	/** 1 unless this call is one the fake GTK is told to accept and drop. */
	const took = (name: string): number => (ignoring.has(name) ? 0 : 1);

	const symbols: LinuxShim = {
		shim_lib_open: () => 1,
		shim_lib_error_text: () => "",
		shim_gtk_init: () => 1,
		shim_pump: () => 1,
		shim_window_new: (title, width, height) => {
			calls.push("window_new");
			live.add(next);
			titles.set(next, uncstring(title));
			sizes.set(next, { width, height });
			return next++;
		},
		shim_window_attach: () => 1,
		shim_window_container: () => next++,
		shim_webview_place: () => 1,
		shim_window_show: () => {},
		shim_window_destroy: (win) => {
			calls.push("window_destroy");
			live.delete(Number(win));
		},
		shim_window_alive: (win) => (live.has(Number(win)) ? 1 : 0),
		shim_webview_new: () => next++,
		shim_webview_load: (_web, url) => {
			urls.push(uncstring(url));
			return 1;
		},
		shim_screen_count: () => 0,
		shim_screen_info: () => 0,
		shim_keyring_open: () => 0,
		shim_keyring_set: () => 0,
		shim_keyring_get: () => null,
		shim_keyring_delete: () => 0,

		shim_window_api_ready: () => ready,
		shim_window_api_missing: () => options.missing ?? "",
		shim_window_present: (win) => {
			calls.push("present");
			return ready ? 1 : 0;
		},
		shim_window_set_title: (win, title) => {
			calls.push("set_title");
			if (!ready) return 0;
			if (!ignoring.has("set_title")) titles.set(Number(win), uncstring(title));
			return 1;
		},
		shim_window_title: (win) => titles.get(Number(win)) ?? null,
		shim_window_resize: (win, width, height) => {
			calls.push("resize");
			if (!ready || ignoring.has("resize")) return 0;
			sizes.set(Number(win), { width, height });
			return 1;
		},
		shim_window_size: (win, out) => {
			const size = sizes.get(Number(win));
			if (!ready || size === undefined) return 0;
			out[0] = size.width;
			out[1] = size.height;
			return 1;
		},
		shim_window_placeable: () => (ready && placeable ? 1 : 0),
		shim_window_move: (win, x, y) => {
			calls.push("move");
			if (!ready || !placeable) return 0;
			positions.set(Number(win), { x, y });
			return 1;
		},
		shim_window_position: (win, out) => {
			const point = positions.get(Number(win));
			if (!ready || !placeable || point === undefined) return 0;
			out[0] = point.x;
			out[1] = point.y;
			return 1;
		},
		shim_window_state: (win) => {
			if (!ready || !realised) return -1;
			return states.get(Number(win)) ?? 0;
		},
		shim_window_flag: (win, flag, on) => {
			calls.push(`flag:${flag}:${on}`);
			if (!ready) return 0;
			const key = Number(win);
			const bit = flag === 0 ? 2 : flag === 1 ? 4 : 16;
			const current = states.get(key) ?? 0;
			states.set(key, on ? current | bit : current & ~bit);
			return 1;
		},
		shim_window_keep_above: (win, on) => {
			calls.push(`keep_above:${on}`);
			if (!ready) return 0;
			const key = Number(win);
			const current = states.get(key) ?? 0;
			states.set(key, on ? current | 32 : current & ~32);
			return 1;
		},
		shim_window_set_decorated: (win, on) => {
			calls.push(`set_decorated:${on}`);
			if (!ready) return 0;
			if (!ignoring.has("set_decorated")) decorated.set(Number(win), on === 1);
			return 1;
		},
		shim_window_decorated: (win) => {
			if (!ready) return -1;
			return decorated.get(Number(win)) === true ? 1 : 0;
		},
		shim_widget_set_opacity: (win, value) => {
			calls.push(`set_opacity:${value}`);
			if (!ready) return 0;
			if (!ignoring.has("set_opacity")) opacity.set(Number(win), value);
			return 1;
		},
		shim_widget_opacity: (win) => {
			if (!ready) return -1;
			return opacity.get(Number(win)) ?? 1;
		},
	};

	return {
		symbols,
		calls,
		titles,
		sizes,
		positions,
		states,
		decorated,
		opacity,
		urls,
		ignoring,
	};
}

/** A started platform over the fake, so every label goes through the real tracking map. */
export async function openFake(
	options: FakeOptions = {},
): Promise<{ shim: FakeShim; platform: LinuxPlatform }> {
	const shim = fakeWindowShim(options);
	const platform = new LinuxPlatform(
		createGtkBackend(
			() => shim.symbols,
			() => [],
		),
	);
	await platform.start();
	return { shim, platform };
}
