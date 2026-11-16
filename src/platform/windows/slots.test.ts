/**
 * The COM slot seam: every vtable index this layer calls, re-derived from the published declaration
 * order rather than restated.
 *
 * `Navigate` was called at slot 37 once, which is `GetBrowserProcessId(UINT *)` — navigation silently
 * did nothing and a process id was written over the URL (2026-11-16). The order below is transcribed
 * from WebView2.h as published (docs.rs/webview2-sys, `ICoreWebView2VTable`,
 * `ICoreWebView2ControllerVTable`, `ICoreWebView2EnvironmentVTable`), so each number is checked against
 * the header's order, not against itself.
 */
import { describe, expect, test } from "bun:test";
import { readShimSource } from "./shim-source.ts";

const source = readShimSource();

/** `#define SHIM_SLOT_NAME n` from the prelude, as a map. */
function slots(): Map<string, number> {
	const found = new Map<string, number>();
	for (const match of source.matchAll(/#define SHIM_SLOT_(\w+) (\d+)/g)) {
		found.set(match[1] ?? "", Number(match[2]));
	}
	return found;
}

/** The published order, after IUnknown's three methods. Only the methods this layer calls. */
const ENVIRONMENT = [
	"CreateCoreWebView2Controller",
	"CreateWebResourceResponse",
	"get_BrowserVersionString",
	"add_NewBrowserVersionAvailable",
	"remove_NewBrowserVersionAvailable",
];
const CONTROLLER = [
	"get_IsVisible",
	"put_IsVisible",
	"get_Bounds",
	"put_Bounds",
	"get_ZoomFactor",
	"put_ZoomFactor",
	"add_ZoomFactorChanged",
	"remove_ZoomFactorChanged",
	"SetBoundsAndZoomFactor",
	"MoveFocus",
	"add_MoveFocusRequested",
	"remove_MoveFocusRequested",
	"add_GotFocus",
	"remove_GotFocus",
	"add_LostFocus",
	"remove_LostFocus",
	"add_AcceleratorKeyPressed",
	"remove_AcceleratorKeyPressed",
	"get_ParentWindow",
	"put_ParentWindow",
	"NotifyParentWindowPositionChanged",
	"Close",
	"get_CoreWebView2",
];
const WEBVIEW = [
	"get_Settings",
	"get_Source",
	"Navigate",
	"NavigateToString",
	"add_NavigationStarting",
];

/** The slot a published method list puts a method at, counting from 3 (past IUnknown). */
function slotOf(order: readonly string[], method: string): number {
	const index = order.indexOf(method);
	expect(index).toBeGreaterThan(-1);
	return index + 3;
}

describe("the vtable slots", () => {
	const defined = slots();

	test("the parser saw the block it is meant to check", () => {
		expect(defined.size).toBe(5);
	});

	test("Navigate is the fifth method of ICoreWebView2, not the thirty-seventh slot", () => {
		expect(defined.get("WEBVIEW_NAVIGATE")).toBe(slotOf(WEBVIEW, "Navigate"));
		expect(defined.get("WEBVIEW_NAVIGATE")).toBe(5);
	});

	test("the controller slots are put_Bounds, Close and get_CoreWebView2", () => {
		expect(defined.get("CONTROLLER_PUT_BOUNDS")).toBe(slotOf(CONTROLLER, "put_Bounds"));
		expect(defined.get("CONTROLLER_CLOSE")).toBe(slotOf(CONTROLLER, "Close"));
		expect(defined.get("CONTROLLER_WEBVIEW")).toBe(slotOf(CONTROLLER, "get_CoreWebView2"));
	});

	test("the environment slot is CreateCoreWebView2Controller", () => {
		expect(defined.get("ENV_CREATE_CONTROLLER")).toBe(
			slotOf(ENVIRONMENT, "CreateCoreWebView2Controller"),
		);
		// The slots after it are where a wrong index lands: CreateWebResourceResponse at 4,
		// get_BrowserVersionString at 5. UI_E_WRONG_THREAD (0x802A000C) is not a slot error, and this is
		// the test that keeps the two apart.
		expect(slotOf(ENVIRONMENT, "CreateWebResourceResponse")).toBe(4);
		expect(slotOf(ENVIRONMENT, "get_BrowserVersionString")).toBe(5);
	});

	/** A bare number in an index is how the Navigate slot drifted; every use must be a name. */
	test("no call site indexes a vtable with a literal", () => {
		expect(source).not.toMatch(/vt\[\d+\]/);
	});
});
