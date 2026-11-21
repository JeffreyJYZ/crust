/**
 * The Windows shim cannot run here, so its drag-minimum behaviour is gated from the assembled
 * source the way `shim-resources.test.ts` gates the slot and size guards. A source assertion is
 * weaker than running WM_GETMINMAXINFO, but it is the only proof available off Windows.
 */
import { describe, expect, test } from "bun:test";
import { readShimSource } from "./shim-source.ts";

const source = readShimSource();

/** The body of a C function, up to its closing brace at column zero. */
function body(signature: string): string {
	const start = source.indexOf(signature);
	expect(start).toBeGreaterThan(-1);
	const rest = source.slice(start);
	return rest.slice(0, rest.indexOf("\n}"));
}

describe("the Win32 window enforces its configured minimum", () => {
	test("WM_GETMINMAXINFO writes ptMinTrackSize from the per-HWND minimum", () => {
		const proc = body("shim_i64 shim_wndproc(");
		expect(proc).toContain("SHIM_WM_GETMINMAXINFO");
		expect(proc).toContain("shim_window_min(hwnd, &minw, &minh)");
		expect(proc).toContain("pt[6] = minw");
		expect(proc).toContain("pt[7] = minh");
		// DefWindowProcW still runs, so the maximum fields keep Windows' defaults.
		expect(proc.indexOf("pt[7] = minh")).toBeLessThan(proc.indexOf("return DefWindowProcW("));
	});

	test("the minimum table is its own part and is set at create", () => {
		// The webview table it used to live beside is `41_surfaces.c` now, and the two bounds are
		// deliberately separate constants: a surface is not a window.
		expect(source).toContain("#define SHIM_MAX_WINDOWS 8");
		expect(source).toContain("static int g_min_w[SHIM_MAX_WINDOWS];");
		expect(source).toContain("static int g_min_h[SHIM_MAX_WINDOWS];");
		expect(body("shim_h shim_window_new(")).toContain("shim_window_set_min(hwnd, w, h)");
		expect(body("int shim_window_destroy(")).toContain("shim_window_set_min(hwnd, 0, 0)");
	});

	test("0x0024 is the Win32 message id", () => {
		expect(source).toContain("#define SHIM_WM_GETMINMAXINFO 0x0024u");
	});
});
