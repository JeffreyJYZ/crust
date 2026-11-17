import { describe, expect, test } from "bun:test";
import { createGtkBackend } from "./backend.ts";
import type { LinuxShim } from "./shim-ffi.ts";

/**
 * A symbol table that records what it was handed and answers like a healthy GTK.
 * This is the only way to prove the argument encoding on a machine with no GTK:
 * the defect it guards against is a JavaScript string reaching an `FFIType.cstring`
 * argument, which bun:ffi throws on before C ever runs.
 */
function fakeShim() {
	const calls: string[] = [];
	const args: Record<string, unknown[]> = {};
	const live = new Set<number>();
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
		shim_window_new: (title, width, height, minWidth) => {
			calls.push("window_new");
			args.window_new = [title, width, height, minWidth];
			live.add(next);
			return next++;
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
		shim_screen_count: () => 0,
		shim_screen_info: () => 0,
	};
	return { symbols, calls, args };
}

/** The string a `cstring` argument carried, decoded from the bytes C receives. */
function decode(value: unknown): string {
	if (!(value instanceof Uint8Array)) throw new Error(`not a byte buffer: ${typeof value}`);
	return new TextDecoder().decode(value);
}

const URL = "http://127.0.0.1:4123/";

describe("FFI argument encoding", () => {
	test("the title is a NUL-terminated buffer, never a JavaScript string", () => {
		const { symbols, args } = fakeShim();
		const backend = createGtkBackend(
			() => symbols,
			() => [],
		);
		backend.load();
		backend.createWindow({ label: "main", title: "crust café" }, URL);
		const title = args.window_new?.[0];
		expect(title).toBeInstanceOf(Uint8Array);
		expect((title as Uint8Array).at(-1)).toBe(0);
		// Five ASCII bytes plus the two-byte é plus the NUL: a byte count, not a
		// character count, and the trailing NUL is the C string's terminator.
		expect(decode(title)).toBe("crust café\u0000");
		expect((title as Uint8Array).length).toBe(12);
	});

	test("the URL reaches the webview as the URL the window was created with", () => {
		const { symbols, args } = fakeShim();
		const backend = createGtkBackend(
			() => symbols,
			() => [],
		);
		backend.load();
		const created = backend.createWindow({ label: "main", url: URL }, URL);
		const url = args.webview_load?.[1];
		expect(url).toBeInstanceOf(Uint8Array);
		expect((url as Uint8Array).at(-1)).toBe(0);
		expect(decode(url)).toBe(`${URL}\u0000`);
		// The backend hands back the same string it navigated to, so `windowUrl`
		// and the webview cannot disagree.
		expect(created.url).toBe(URL);
	});

	test("an absent title is one NUL byte, not an empty string", () => {
		const { symbols, args } = fakeShim();
		const backend = createGtkBackend(
			() => symbols,
			() => [],
		);
		backend.load();
		backend.createWindow({ label: "main" }, URL);
		const title = args.window_new?.[0];
		expect(title).toBeInstanceOf(Uint8Array);
		expect((title as Uint8Array).length).toBe(1);
		expect(decode(title)).toBe("\u0000");
	});

	test("the C entry points run in the order that builds a usable window", () => {
		const { symbols, calls } = fakeShim();
		const backend = createGtkBackend(
			() => symbols,
			() => [],
		);
		backend.load();
		backend.createWindow({ label: "main", title: "main" }, URL);
		expect(calls).toEqual([
			"lib_open",
			"gtk_init",
			"window_new",
			"webview_new",
			"window_attach",
			"webview_load",
			"window_show",
		]);
	});
});

describe("guards", () => {
	test("createWindow before load throws instead of calling a null entry point", () => {
		const { symbols, calls } = fakeShim();
		const backend = createGtkBackend(
			() => symbols,
			() => [],
		);
		expect(() => backend.createWindow({ label: "main" }, URL)).toThrow("before load");
		expect(calls).toEqual([]);
	});

	test("isOpen is false before load and after a destroy", () => {
		const { symbols } = fakeShim();
		const backend = createGtkBackend(
			() => symbols,
			() => [],
		);
		expect(backend.isOpen(100n)).toBe(false);
		backend.load();
		const created = backend.createWindow({ label: "main" }, URL);
		expect(backend.isOpen(created.win)).toBe(true);
		backend.destroy(created.win);
		expect(backend.isOpen(created.win)).toBe(false);
	});

	test("a library that will not load throws the preflight text", () => {
		const { symbols } = fakeShim();
		symbols.shim_lib_open = () => 0;
		symbols.shim_lib_error_text = () => "cannot load libgtk-3.so.0";
		const backend = createGtkBackend(
			() => symbols,
			() => [],
		);
		expect(() => backend.load()).toThrow("cannot load libgtk-3.so.0");
		expect(() => backend.load()).toThrow("apt install");
	});
});
