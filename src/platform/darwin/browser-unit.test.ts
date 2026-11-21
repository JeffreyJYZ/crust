/**
 * The compiled browser unit: `cc()` really builds `shim/131_browser.c`, the runtime-built
 * `WKUIDelegate` class comes back, and its capture policy is the deny constant rather than a number
 * this test also wrote. Nothing is loaded and no window is touched, so the suite can run while
 * somebody is typing.
 */
import { describe, expect, test } from "bun:test";
import { ptr } from "bun:ffi";
import { browserUnit } from "./browser-unit";

const notDarwin = process.platform !== "darwin";

describe("the compiled browser unit", () => {
	test.skipIf(notDarwin)("builds the two delegates and reports capture denied", () => {
		const unit = browserUnit();
		// 2 is WKPermissionDecisionDeny, the only answer a remote page may receive.
		expect(Number(unit.symbols.shim_browser_capture_decision())).toBe(2);
	});

	test.skipIf(notDarwin)("makes a view and frames it without an object crossing bun:ffi", () => {
		const unit = browserUnit();
		const view = Number(unit.symbols.shim_browser_view_new());
		expect(view).not.toBe(0);
		expect(() => unit.symbols.shim_browser_view_set_frame(view, 1, 2, 300, 200)).not.toThrow();
		expect(() => unit.symbols.shim_browser_detach(view)).not.toThrow();
	});

	test.skipIf(notDarwin)("a popup URL read before any popup is empty, not stale", () => {
		const unit = browserUnit();
		const buffer = new Uint8Array(64);
		expect(Number(unit.symbols.shim_browser_popup_url(ptr(buffer), buffer.length))).toBe(0);
		expect(Number(unit.symbols.shim_browser_ui_installed(0))).toBe(0);
	});
});
