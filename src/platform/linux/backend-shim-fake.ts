/**
 * A Linux shim symbol table that answers like a healthy GTK and records what it was handed. It is
 * the only way to prove the argument encoding on a machine with no GTK: the defect it guards against
 * is a JavaScript string reaching an `FFIType.cstring` argument, which bun:ffi throws on before C
 * ever runs. Split out of `backend.test.ts` at the line cap, and because the container's own suite
 * needs the same table rather than a second copy that could drift.
 */
import type { LinuxShim } from "./shim-ffi.ts";

export interface FakeShim {
	symbols: LinuxShim;
	/** One entry per native call, in the order the backend made them. */
	calls: string[];
	/** The arguments the last call of each name carried. */
	args: Record<string, unknown[]>;
	/** Every container this fake minted, so a test can tell one window's box from another's. */
	boxes: number[];
}

/** A symbol table that records its arguments and answers like a healthy GTK. */
export function fakeShim(): FakeShim {
	const calls: string[] = [];
	const args: Record<string, unknown[]> = {};
	const boxes: number[] = [];
	const live = new Set<number>();
	const boxFor = new Map<number, number>();
	let next = 100;
	const symbols: LinuxShim = {
		shim_lib_open: () => {
			calls.push("lib_open");
			return 1;
		},
		shim_lib_error_text: () => "",
		shim_gtk_init: () => {
			calls.push("gtk_init");
			return 1;
		},
		shim_pump: () => 1,
		shim_window_new: (title, width, height, minWidth, minHeight) => {
			calls.push("window_new");
			args.window_new = [title, width, height, minWidth, minHeight];
			live.add(next);
			return next++;
		},
		shim_window_container: (win) => {
			calls.push("window_container");
			const key = Number(win);
			const held = boxFor.get(key);
			if (held !== undefined) return held;
			// A container is one per window, created on first ask and returned again after.
			const box = next++;
			boxFor.set(key, box);
			boxes.push(box);
			return box;
		},
		shim_window_attach: (win, child) => {
			calls.push("window_attach");
			args.window_attach = [win, child];
			return 1;
		},
		shim_window_show: (win) => {
			calls.push("window_show");
			args.window_show = [win];
		},
		shim_window_destroy: (win) => {
			calls.push("window_destroy");
			args.window_destroy = [win];
			live.delete(Number(win));
		},
		shim_window_alive: (win) => (live.has(Number(win)) ? 1 : 0),
		shim_webview_new: () => {
			calls.push("webview_new");
			return next++;
		},
		shim_webview_load: (web, url) => {
			calls.push("webview_load");
			args.webview_load = [web, url];
			return 1;
		},
		shim_webview_place: (box, web, x, y, width, height) => {
			calls.push("webview_place");
			args.webview_place = [box, web, x, y, width, height];
			return boxes.includes(Number(box)) ? 1 : 0;
		},
		shim_screen_count: () => 0,
		shim_screen_info: () => 0,
		shim_keyring_open: () => 0,
		shim_keyring_set: () => 0,
		shim_keyring_get: () => null,
		shim_keyring_delete: () => 0,
	};
	return { symbols, calls, args, boxes };
}

/** The string a `cstring` argument carried, decoded from the bytes C receives. */
export function decode(value: unknown): string {
	if (!(value instanceof Uint8Array)) throw new Error(`not a byte buffer: ${typeof value}`);
	return new TextDecoder().decode(value);
}
