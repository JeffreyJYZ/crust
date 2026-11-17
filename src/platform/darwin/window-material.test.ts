/**
 * The darwin material path is read from source rather than launched: a vibrancy window would take
 * focus and paint on the user's screen. What can be checked here is the C that AppKit receives —
 * the measured Butter setup and the drawsBackground escape hatch — and that the FFI arities match.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { shim } from "./index.ts";
import { SHIM_PART_NAMES } from "./shim-source.ts";

const source = SHIM_PART_NAMES.map((name) =>
	readFileSync(join(import.meta.dir, "shim", name), "utf8"),
).join("\n");

describe("the vibrancy C follows Butter's measured setup", () => {
	test("the assembled shim compiles with the new C part", () => {
		const symbols = shim().symbols;
		expect(typeof symbols.shim_window_set_material).toBe("function");
		expect(typeof symbols.shim_webview_set_draws_background).toBe("function");
	});

	test("the effect view uses BehindWindow, Active, Sidebar and NSWindowBelow", () => {
		const material = source.slice(source.indexOf("int shim_window_set_material"));
		expect(material).toContain('objc_getClass("NSVisualEffectView")');
		expect(material).toContain('sel_registerName("setBlendingMode:"), 0');
		expect(material).toContain('sel_registerName("setState:"), 1');
		expect(material).toContain('sel_registerName("setMaterial:"), 7');
		expect(material).toContain('sel_registerName("addSubview:positioned:relativeTo:")');
		expect(material).toContain('setOpaque:"');
		expect(material).toContain('sel_registerName("clearColor")');
	});

	test("the webview drops its opaque background for a material", () => {
		const webview = source.slice(source.indexOf("void shim_webview_set_draws_background"));
		expect(webview).toContain('__CFStringMakeConstantString("drawsBackground")');
		expect(webview).toContain('sel_registerName("setValue:forKey:")');
	});

	test("the shim parts are in one compilation unit, material included", () => {
		expect(SHIM_PART_NAMES).toContain("115_window_material.c");
		expect(source.indexOf("int shim_window_set_material")).toBeGreaterThan(
			source.indexOf("typedef struct {\n\tdouble x, y, w, h;"),
		);
	});
});
