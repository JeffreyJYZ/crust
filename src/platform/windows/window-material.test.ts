/**
 * The Windows material path cannot run on a Mac, so the C is proved by compiling the assembled
 * shim source with the same TinyCC options the real backend uses, and by reading that source for
 * the DWM attribute. `window-open.ts` is proved with the fake shim: the build gate and the HRESULT.
 */
import { describe, expect, test } from "bun:test";
import { cc } from "bun:ffi";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CrustError } from "@/bridge/errors";
import { fakeShim } from "./fake-shim.ts";
import { SHIM_CC_OPTIONS } from "./ffi.ts";
import { shimSource } from "./shim-source.ts";
import { BACKDROP, materialFailure, MIN_MATERIAL_BUILD, openWindow } from "./window-open.ts";

const NEW = String(MIN_MATERIAL_BUILD);

describe("the material C compiles and names the DWM contract", () => {
	test("cc() accepts the whole assembled unit", () => {
		// `cc()` feeds a file path to TinyCC. The shim's two kernel32 imports are resolved on
		// Windows by TinyCC's CRT; on this Mac define them locally so the whole unit (including
		// the new part) still compiles, proving its syntax and its shared types.
		const stub =
			"\nshim_h LoadLibraryA(const char *name) { (void)name; return 0; }\n" +
			"void *GetProcAddress(shim_h module, const char *name) { (void)module; (void)name; return 0; }\n";
		const path = join(tmpdir(), `crust-material-${Bun.hash(shimSource).toString(16)}.c`);
		writeFileSync(path, shimSource + stub);
		expect(() =>
			cc({ source: path, symbols: { shim_window_set_material: { args: [], returns: 3 } } }),
		).not.toThrow();
		expect(SHIM_CC_OPTIONS).toContain("std=c11");
	});

	test("attribute 38 sets mica and acrylic, and dark mode is left alone", () => {
		expect(shimSource).toContain('dwm, "DwmSetWindowAttribute"');
		expect(shimSource).toContain("set_attr(hwnd, 38u, &kind");
		expect(shimSource).toContain("kind != 2 && kind != 3 && kind != 4");
		expect(BACKDROP).toEqual({ mica: 2, acrylic: 3, tabbed: 4 });
		// Butter also sends attribute 20; crust must not change a window's theme.
		expect(shimSource).not.toContain("20u, &useDark");
	});
});

describe("the Windows build gate is a typed failure", () => {
	test("a build older than 22621 names the material and the required build", () => {
		for (const material of ["mica", "acrylic"] as const) {
			const error = materialFailure(material, "10.0.22000");
			expect(error).toBeInstanceOf(CrustError);
			expect(error?.code).toBe("not-implemented");
			expect(error?.requires).toContain(NEW);
			expect(error?.message).toContain(material);
		}
	});

	test("none, absent and a modern build pass", () => {
		expect(materialFailure(undefined, "10.0.22000")).toBeUndefined();
		expect(materialFailure("none", "10.0.22000")).toBeUndefined();
		expect(materialFailure("mica", "10.0.22631")).toBeUndefined();
	});

	test("an unreadable build fails rather than guessing", () => {
		const error = materialFailure("mica", "unknown");
		expect(error?.message).toContain("unknown");
	});
});

describe("openWindow applies a material only when asked", () => {
	test("mica sends backdrop 2 to the shim", () => {
		const calls: string[] = [];
		const shim = fakeShim({}, calls);
		openWindow(shim, { label: "main", material: "mica" }, "crust", "", "10.0.22631");
		expect(calls).toContain("material:100:2");
	});

	test("a refused DWM call destroys the window and throws", () => {
		const calls: string[] = [];
		const shim = { ...fakeShim({}, calls), shim_window_set_material: () => -5 };
		expect(() =>
			openWindow(shim, { label: "main", material: "acrylic" }, "crust", "", "10.0.22631"),
		).toThrow('window material "acrylic" was refused by DWM');
		expect(calls).toContain("window_destroy");
		expect(calls).not.toContain("webview_close");
	});

	test("no material keeps the old path with no DWM call", () => {
		const calls: string[] = [];
		openWindow(fakeShim({}, calls), { label: "main" }, "crust", "", "10.0.22000");
		expect(calls.some((call) => call.startsWith("material:"))).toBe(false);
	});
});
