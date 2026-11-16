/**
 * The shim source is compiled from files on disk, so its line endings are whatever the checkout
 * produced. Every source-scanning assertion in this layer matches `\n\t` inside a multi-line
 * expectation, which is invisible until a Windows checkout hands back CRLF — and then the same
 * assertion passes on macOS and Linux and fails only on the runner (measured 2026-11-16).
 */
import { describe, expect, test } from "bun:test";
import { SHIM_PARTS, lf, shimSource } from "./shim-source.ts";

describe("the shim source is line-ending independent", () => {
	test("lf turns a CRLF source into LF", () => {
		expect(lf("int a;\r\n\tif (!a) return 0;\r\n")).toBe("int a;\n\tif (!a) return 0;\n");
	});

	test("lf leaves an LF source untouched", () => {
		const source = "int a;\n\tif (!a) return 0;\n";
		expect(lf(source)).toBe(source);
	});

	test("no part carries a carriage return", () => {
		for (const part of SHIM_PARTS) expect(part.includes("\r")).toBe(false);
	});

	test("the assembled unit carries no carriage return", () => {
		expect(shimSource.includes("\r")).toBe(false);
	});

	test("a multi-line expectation matches whatever the checkout produced", () => {
		// The exact shape that failed only on Windows: a `\n\t` inside a multi-line expectation.
		expect(shimSource).toContain(
			"int shim_webview_attach(shim_h hwnd) {\n\tif (!shim_webview_bind(hwnd))",
		);
	});
});
