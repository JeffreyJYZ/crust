import { describe, expect, test } from "bun:test";
import { SHIM_PARTS, SHIM_PART_NAMES, SHIM_PART_PATHS, shimSource } from "./index.ts";

describe("shim assembly", () => {
	test("every part is present and non-empty", () => {
		expect(SHIM_PARTS).toHaveLength(4);
		for (const part of SHIM_PARTS) expect(part.trim().length).toBeGreaterThan(0);
	});

	test("the parts are joined in numeric order", () => {
		// Full signatures, not bare names: the prelude forward-declares
		// `shim_pump_resolve`, so `shim_pump` alone would match the first part.
		const order = [
			"int shim_lib_open(void)",
			"WebKitWebView *shim_webview_new(void)",
			"void *shim_window_new(",
			"int shim_pump(void)",
		];
		const at = order.map((symbol) => shimSource.indexOf(symbol));
		for (const index of at) expect(index).toBeGreaterThan(-1);
		expect([...at].sort((a, b) => a - b)).toEqual(at);
	});

	test("no part includes a header: every symbol is a hand-written prototype", () => {
		// A directive at line start, not the word in a comment explaining its absence.
		for (const part of SHIM_PARTS) expect(/^\s*#include/m.test(part)).toBe(false);
	});

	test("the unit carries the library load, the loop and the window calls", () => {
		expect(shimSource).toContain("dlopen(");
		expect(shimSource).toContain("g_main_context_iteration");
		expect(shimSource).toContain("gtk_window_new");
		expect(shimSource).toContain("webkit_web_view_load_uri");
	});

	test("the path and name lists agree with the parts", () => {
		expect(SHIM_PART_PATHS).toHaveLength(SHIM_PARTS.length);
		expect(SHIM_PART_NAMES).toEqual([
			"10_prelude.c",
			"30_webview.c",
			"40_window.c",
			"50_pump.c",
		]);
	});

	test("no part serves a URI scheme: a page loads from the bridge URL", () => {
		expect(shimSource).not.toContain("register_uri_scheme");
		expect(shimSource).not.toContain("webkit_uri_scheme_request");
	});
});
