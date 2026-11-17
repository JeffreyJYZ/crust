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

describe("the create size is clamped to the configured minimum", () => {
	test("a window smaller than both minimums opens at the minimum", () => {
		const calls: string[] = [];
		const shim = fakeShim({}, calls);
		openWindow(
			shim,
			{ label: "main", width: 600, height: 400, minWidth: 800, minHeight: 600 },
			"crust",
			"",
		);
		expect(calls).toContain("window_new:main:800x600:crust");
	});

	test("a window already at or above its minimum keeps its configured size", () => {
		const calls: string[] = [];
		const shim = fakeShim({}, calls);
		openWindow(
			shim,
			{ label: "main", width: 1000, height: 700, minWidth: 800, minHeight: 600 },
			"crust",
			"",
		);
		expect(calls).toContain("window_new:main:1000x700:crust");
	});
});
