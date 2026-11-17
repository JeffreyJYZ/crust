/**
 * The failed-create path. `shim_webview_new` binds a controller before it navigates, so a
 * Navigate failure has already taken a slot; closing the window alone never gives it back.
 */
import { describe, expect, test } from "bun:test";
import { fakeShim } from "./fake-shim.ts";
import { openWindow } from "./window-open.ts";

describe("a failed create gives the controller back", () => {
	test("closes the webview before destroying the window", () => {
		const calls: string[] = [];
		const shim = fakeShim({ failWebView: true }, calls);
		expect(() => openWindow(shim, { label: "main" }, "crust", "")).toThrow(
			"WebView2 controller failed",
		);
		expect(calls.filter((call) => call === "webview_close")).toHaveLength(1);
		expect(calls.filter((call) => call === "window_destroy")).toHaveLength(1);
		// Closing first is what clears the slot and releases the controller.
		expect(calls.indexOf("webview_close")).toBeLessThan(calls.indexOf("window_destroy"));
	});

	test("a refused CreateWindowExW has nothing to close", () => {
		const calls: string[] = [];
		const shim = fakeShim({ failWindow: true }, calls);
		expect(() => openWindow(shim, { label: "main" }, "crust", "")).toThrow(
			"CreateWindowExW failed",
		);
		expect(calls).not.toContain("webview_close");
	});
});
