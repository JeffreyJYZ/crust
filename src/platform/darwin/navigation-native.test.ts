/**
 * The native proof both new units need and neither can get from a plugin test: `cc()` compiles
 * them, links AppKit and WebKit, the runtime `WKNavigationDelegate` really carries its five
 * callbacks, and the find completion block really builds. Every call here passes a null webview,
 * so no window is created, no page loads and no delegate is installed on anything — a suite that
 * opened a window on a machine someone is using would be a defect, not a proof.
 */

import { describe, expect, test } from "bun:test";
import { FIND_STATUS, findUnit } from "./find-unit.ts";
import { navigationUnit, NAVIGATION_STATUS } from "./navigation-unit.ts";

/** Every callback `class_addMethod` had to add, 31 for all five. */
const ALL_CALLBACKS = 31;

describe("navigation and find C units", () => {
	test("the navigation unit compiles and links WebKit", () => {
		const symbols = navigationUnit().symbols;
		expect(typeof symbols.crust_nav_install).toBe("function");
		expect(typeof symbols.crust_nav_webview).toBe("function");
		expect(typeof symbols.crust_nav_class_ready).toBe("function");
	});

	test("the runtime delegate carries all five callbacks", () => {
		expect(Number(navigationUnit().symbols.crust_nav_class_ready() ?? 0)).toBe(ALL_CALLBACKS);
	});

	test("a null webview is refused by every entry point, not sent to", () => {
		const symbols = navigationUnit().symbols;
		expect(Number(symbols.crust_nav_install(0) ?? -1)).toBe(NAVIGATION_STATUS.missing);
		expect(Number(symbols.crust_nav_uninstall(0) ?? -1)).toBe(0);
		expect(Number(symbols.crust_nav_webview(0) ?? 0)).toBe(0);
		expect(Number(symbols.crust_nav_loading(0) ?? -1)).toBe(0);
		expect(Number(symbols.crust_nav_can_go_back(0) ?? -1)).toBe(0);
		expect(Number(symbols.crust_nav_can_go_forward(0) ?? -1)).toBe(0);
		expect(Number(symbols.crust_nav_reload(0) ?? -1)).toBe(0);
		expect(Number(symbols.crust_nav_go_back(0) ?? -1)).toBe(0);
		expect(Number(symbols.crust_nav_go_forward(0) ?? -1)).toBe(0);
		expect(Number(symbols.crust_nav_url(0, 0, 0) ?? 0)).toBe(-1);
		expect(Number(symbols.crust_nav_title(0, 0, 0) ?? 0)).toBe(-1);
	});

	test("the find unit compiles and its completion block builds", () => {
		const symbols = findUnit().symbols;
		expect(typeof symbols.crust_find_search).toBe("function");
		expect(Number(symbols.crust_find_block_ready() ?? 0)).toBe(1);
	});

	test("find refuses a null webview and a repeat with no search behind it", () => {
		const symbols = findUnit().symbols;
		expect(Number(symbols.crust_find_available(0) ?? -1)).toBe(0);
		expect(Number(symbols.crust_find_repeat(0, 0, 0) ?? -1)).toBe(FIND_STATUS.unavailable);
	});
});
