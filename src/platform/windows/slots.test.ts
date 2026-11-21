/**
 * The COM slot seam: every vtable index this layer calls, re-derived from the published declaration
 * order rather than restated. `Navigate` was called at slot 37 once, which is
 * get_BrowserProcessId(UINT *) — navigation silently did nothing. The method lists live in
 * `slot-tables.ts` with their interface names so this test and the pin-every-constant test cannot
 * drift apart.
 */
import { describe, expect, test } from "bun:test";
import { readShimSource } from "./shim-source.ts";
import { CONTROLLER, ENVIRONMENT, NAV_ARGS, NEW_WINDOW, slotOf, WEBVIEW } from "./slot-tables.ts";

const source = readShimSource();

/** `#define SHIM_SLOT_NAME n` from the prelude, as a map. */
function slots(): Map<string, number> {
	const found = new Map<string, number>();
	for (const match of source.matchAll(/#define SHIM_SLOT_(\w+) (\d+)/g)) {
		found.set(match[1] ?? "", Number(match[2]));
	}
	return found;
}

/**
 * Every exported SHIM_SLOT_* constant, pinned to its interface's method list. The list is transcribed
 * in `slot-tables.ts` next to the interface name, so a reviewer can check any index without a COM
 * reference. The NavigationStarting pair is the loaded example: get_Uri 3, put_Cancel 8 — calling
 * slot 4 or 6 looks fine in source and crashes only on a real WebView2.
 */
const PINNED = [
	["ENV_CREATE_CONTROLLER", ENVIRONMENT, "CreateCoreWebView2Controller"],
	["IUNKNOWN_ADDREF", [], "AddRef"],
	["CONTROLLER_PUT_VISIBLE", CONTROLLER, "put_IsVisible"],
	["CONTROLLER_PUT_BOUNDS", CONTROLLER, "put_Bounds"],
	["CONTROLLER_CLOSE", CONTROLLER, "Close"],
	["CONTROLLER_WEBVIEW", CONTROLLER, "get_CoreWebView2"],
	["WEBVIEW_GET_SOURCE", WEBVIEW, "get_Source"],
	["WEBVIEW_NAVIGATE", WEBVIEW, "Navigate"],
	["WEBVIEW_NAVIGATE_TO_STRING", WEBVIEW, "NavigateToString"],
	["WEBVIEW_ADD_NAV_STARTING", WEBVIEW, "add_NavigationStarting"],
	["WEBVIEW_ADD_NAV_COMPLETED", WEBVIEW, "add_NavigationCompleted"],
	["WEBVIEW_CAN_GO_BACK", WEBVIEW, "get_CanGoBack"],
	["WEBVIEW_CAN_GO_FORWARD", WEBVIEW, "get_CanGoForward"],
	["WEBVIEW_ADD_NEW_WINDOW", WEBVIEW, "add_NewWindowRequested"],
	["WEBVIEW_GET_TITLE", WEBVIEW, "get_DocumentTitle"],
	["NEWWINDOW_GET_URI", NEW_WINDOW, "get_Uri"],
	["NEWWINDOW_PUT_HANDLED", NEW_WINDOW, "put_Handled"],
	["NAV_ARGS_GET_URI", NAV_ARGS, "get_Uri"],
	["NAV_ARGS_PUT_CANCEL", NAV_ARGS, "put_Cancel"],
] as const;

describe("the vtable slots", () => {
	const defined = slots();

	test("the parser saw the whole block, and every constant is pinned", () => {
		expect(defined.size).toBe(PINNED.length);
		for (const [name] of PINNED) expect(defined.has(name)).toBe(true);
	});

	test("every constant equals its method's position in its published interface", () => {
		for (const [name, order, method] of PINNED) {
			// AddRef is IUnknown slot 1; every other list begins after IUnknown's three methods.
			const want = order.length === 0 ? 1 : slotOf(order, method);
			if (order.length > 0) expect(order).toContain(method);
			expect(defined.get(name)).toBe(want);
		}
	});

	test("the neighbours a wrong index would land on are not the ones used", () => {
		expect(defined.get("WEBVIEW_NAVIGATE")).toBe(5);
		expect(slotOf(WEBVIEW, "get_BrowserProcessId")).toBe(37);
		expect(defined.get("WEBVIEW_CAN_GO_BACK")).toBe(38);
		expect(slotOf(ENVIRONMENT, "CreateWebResourceResponse")).toBe(4);
		expect(slotOf(NEW_WINDOW, "put_Handled")).toBe(6);
		expect(slotOf(NAV_ARGS, "get_Uri")).toBe(3);
		expect(slotOf(NAV_ARGS, "put_Cancel")).toBe(8);
	});

	/** A bare number in an index is how the Navigate slot drifted; every use must be a name. */
	test("no call site indexes a vtable with a literal", () => {
		expect(source).not.toMatch(/vt\[\d+\]/);
	});
});
