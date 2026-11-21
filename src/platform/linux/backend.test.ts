import { describe, expect, test } from "bun:test";
import { createGtkBackend } from "./backend.ts";
import { decode, fakeShim } from "./backend-shim-fake.ts";

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

	test("both minimums reach the shim, and a width-only floor sends no height", () => {
		const { symbols, args } = fakeShim();
		const backend = createGtkBackend(
			() => symbols,
			() => [],
		);
		backend.load();
		backend.createWindow({ label: "both", minWidth: 400, minHeight: 480 }, URL);
		expect([args.window_new?.[3], args.window_new?.[4]]).toEqual([400, 480]);
		backend.createWindow({ label: "width", minWidth: 400 }, URL);
		// 0 is "no minimum" here: the shim turns it into GTK's -1 rather than a floor of
		// zero, so a width-only config can still be dragged shorter than its opening height.
		expect([args.window_new?.[3], args.window_new?.[4]]).toEqual([400, 0]);
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
			"window_container",
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
