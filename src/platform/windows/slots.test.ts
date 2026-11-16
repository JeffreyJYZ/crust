/**
 * The COM seam: two things here were guessed wrong once and neither can be executed on a Mac, so
 * both are pinned by reading the unit's own source.
 *
 * 1. **Slot indices.** `Navigate` was called at slot 37, which is `GetBrowserProcessId(UINT *)` —
 *    navigation silently did nothing and a process id was written over the URL (2026-11-16). The
 *    order below is transcribed from WebView2.h as published (docs.rs/webview2-sys,
 *    `ICoreWebView2VTable` / `ICoreWebView2ControllerVTable` / `ICoreWebView2EnvironmentVTable`),
 *    so the numbers are checked against the declaration order rather than against themselves.
 * 2. **The handler vtable is built at run time.** A static initialiser holding code addresses is a
 *    relocated pointer in the image, and the only one in the unit was the table WebView2's first
 *    callback jumped through, to `0xFFFFFFFFFFFFFFFF`.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SHIM_PART_NAMES } from "./shim-source.ts";

const SHIM = join(import.meta.dir, "shim");
const source = SHIM_PART_NAMES.map((name) => readFileSync(join(SHIM, name), "utf8")).join("\n");

/** `#define SHIM_SLOT_NAME n` from the prelude, as a map. */
function slots(): Map<string, number> {
	const found = new Map<string, number>();
	for (const match of source.matchAll(/#define SHIM_SLOT_(\w+) (\d+)/g)) {
		found.set(match[1] ?? "", Number(match[2]));
	}
	return found;
}

/** The published order, after IUnknown's three methods. Only the methods this layer calls. */
const ENVIRONMENT = ["CreateCoreWebView2Controller"];
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
	});

	/** A bare number in an index is how the Navigate slot drifted; every use must be a name. */
	test("no call site indexes a vtable with a literal", () => {
		expect(source).not.toMatch(/vt\[\d+\]/);
	});
});

describe("the handler vtable", () => {
	test("is not a static initialiser, because that pointer is relocated by the image", () => {
		expect(source).not.toMatch(/handler_vtbl\[4\]\s*=\s*\{/);
		expect(source).not.toMatch(/=\s*\{\s*\(void \*\)handler_/);
	});

	test("is assigned entry by entry, once, before the first COM call", () => {
		for (const [index, name] of [
			"handler_qi",
			"handler_addref",
			"handler_release",
			"handler_invoke",
		].entries()) {
			expect(source).toContain(`g_handler_vtbl[${index}] = (void *)${name};`);
		}
		// `handler_init` fills it, and both objects go through it.
		expect(source).toContain("void handler_init(shim_handler *h) {");
		expect(source).toContain("handler_init(&g_env_handler)");
		expect(source).toContain("handler_init(&g_ctrl_handler)");
	});

	/**
	 * QueryInterface answers every IID, so WebView2 is told this object supports interfaces it does
	 * not have. A call to one of those must land on a refusal, not on whatever follows the table in
	 * .bss — which is how a call becomes a jump to `-1`.
	 */
	test("pads every slot past Invoke with a refusal", () => {
		expect(source).toContain("#define SHIM_HANDLER_SLOTS 8");
		expect(source).toMatch(/for \(slot = 4; slot < SHIM_HANDLER_SLOTS; slot\+\+\)/);
		expect(source).toContain("g_handler_vtbl[slot] = (void *)handler_unsupported;");
		expect(source).toContain("return -2147467262LL; /* E_NOINTERFACE */");
	});

	/** The readback the probe prints, so a wrong layout is a number instead of a guess. */
	test("can be read back, the way Windows reads it", () => {
		expect(source).toContain("shim_i64 shim_handler_vtbl_addr(void)");
		expect(source).toContain("shim_i64 shim_handler_entry(int index)");
		expect(source).toContain("shim_i64 shim_handler_first_field(void)");
		expect(source).toContain("int shim_handler_prepare(void)");
	});
});
