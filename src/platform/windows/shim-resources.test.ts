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
	test("webview_close compacts the table and lowers the high-water mark", () => {
		const close = body("void shim_webview_close(shim_h hwnd) {");
		expect(close).toContain("wv2_controller_close(g_ctrl[i])");
		// Without these, eight failed navigations leave g_windows at 8 and every later bind
		// returns 0, so createWindow throws "WebView2 controller failed" forever.
		expect(close).toContain("g_windows--");
		expect(close).toContain("g_ctrl[i] = g_ctrl[i + 1]");
		expect(close).toContain("g_hwnd[g_windows] = 0");
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
