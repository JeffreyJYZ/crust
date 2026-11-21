/**
 * Two C-side guards that only a real Windows runner executes. Read from the source because
 * nothing on this machine can call user32 or a WebView2 vtable.
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

describe("a failed create cannot burn a window slot", () => {
	test("webview_close releases the handle's slot, so the next create reuses it", () => {
		const close = body("void shim_webview_close(shim_h hwnd) {");
		expect(close).toContain("wv2_controller_close(ctrl)");
		// Without this, eight failed navigations leave eight live surfaces and every later bind
		// returns 0, so createWindow throws "WebView2 controller failed" forever.
		expect(close).toContain("shim_surface_release(handle)");
		// Handles are indexes and must not move: compacting the array would rename a live surface.
		expect(close).not.toContain("g_ctrl[i] = g_ctrl[i + 1]");
	});
});

describe("WM_SIZE never resizes from an unread rectangle", () => {
	test("GetClientRect failure returns before put_bounds", () => {
		const proc = source.slice(source.indexOf("shim_i64 shim_wndproc("));
		const size = proc.slice(0, proc.indexOf("\treturn 0;"));
		expect(size).toContain("if (!GetClientRect(hwnd, rect)) return 0;");
		expect(size.indexOf("if (!GetClientRect")).toBeLessThan(
			size.indexOf("shim_webview_put_bounds"),
		);
		expect(size).toContain("int rect[4];");
	});
});
