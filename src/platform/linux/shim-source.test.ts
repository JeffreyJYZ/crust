import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SHIM_PART_NAMES, SHIM_PART_PATHS, SHIM_PARTS, shimSource } from "./index.ts";

describe("shim assembly", () => {
	test("every part is present and non-empty", () => {
		expect(SHIM_PARTS).toHaveLength(16);
		for (const part of SHIM_PARTS) expect(part.trim().length).toBeGreaterThan(0);
	});

	test("the parts are joined in numeric order", () => {
		// Full signatures, not bare names: the prelude forward-declares
		// `shim_pump_resolve`, so `shim_pump` alone would match the first part.
		const order = [
			"int shim_lib_open(void)",
			"WebKitWebView *shim_webview_new(void)",
			"void *shim_window_new(",
			"int shim_pump(void)",
		];
		const at = order.map((symbol) => shimSource.indexOf(symbol));
		for (const index of at) expect(index).toBeGreaterThan(-1);
		expect([...at].sort((a, b) => a - b)).toEqual(at);
	});

	test("no part includes a header: every symbol is a hand-written prototype", () => {
		// A directive at line start, not the word in a comment explaining its absence.
		for (const part of SHIM_PARTS) expect(/^\s*#include/m.test(part)).toBe(false);
	});

	test("the unit carries the library load, the loop and the window calls", () => {
		expect(shimSource).toContain("dlopen(");
		expect(shimSource).toContain("g_main_context_iteration");
		expect(shimSource).toContain("gtk_window_new");
		expect(shimSource).toContain("webkit_web_view_load_uri");
	});

	test("the path and name lists agree with the parts", () => {
		expect(SHIM_PART_PATHS).toHaveLength(SHIM_PARTS.length);
		expect(SHIM_PART_NAMES).toEqual([
			"10_prelude.c",
			"30_webview.c",
			"31_browser.c",
			"32_view_state.c",
			"40_window.c",
			"41_container.c",
			"45_window_api.c",
			"46_window_state_api.c",
			"50_pump.c",
			"60_screen.c",
			"70_keyring.c",
			"80_clipboard.c",
			"81_opener.c",
			"82_osinfo.c",
			"83_dialog.c",
			"84_dialog_calls.c",
		]);
	});

	test("no part serves a URI scheme: a page loads from the bridge URL", () => {
		expect(shimSource).not.toContain("register_uri_scheme");
		expect(shimSource).not.toContain("webkit_uri_scheme_request");
	});
});

/**
 * The C parts cannot run on a machine without GTK, so these pin the source shape
 * of the native contracts the JS side relies on. Each one failed against the
 * original shim and is the guard that stops the defect from being reintroduced.
 */
describe("native contracts", () => {
	const [prelude, webview, browser, viewState, windowPart, container, , , pump] = SHIM_PARTS;
	void browser;

	test("a destroyed window releases its slot so a later window can reuse it", () => {
		expect(windowPart).toContain("shim_slots[i].win = 0");
		expect(windowPart).toContain("shim_slot_release(widget)");
		expect(windowPart).toContain("if (slot < 0 && shim_slot_count < 32)");
	});

	test("a failed library open closes its handles before returning", () => {
		expect(prelude).toContain("extern int dlclose(void *handle)");
		expect(prelude).toContain("static void shim_close_libraries(void)");
		// Both failure branches — WebKit missing and any resolve failing.
		expect(prelude).toContain("if (!shim_webkit) {\n\t\tshim_close_libraries();");
		expect(prelude).toContain("!shim_pump_resolve()) {\n\t\tshim_close_libraries();");
	});

	test("a failed script evaluation frees its GError and any value it carried", () => {
		// The eval-done handler lives in the state part now, because the answer belongs to the view
		// that asked rather than to one process-wide slot.
		expect(webview).toContain('shim_sym_or_null(h, "g_error_free")');
		expect(viewState).toContain("if (shim_g_error_free) shim_g_error_free(error)");
		expect(viewState).toContain("if (value && shim_object_unref) shim_object_unref(value)");
	});

	test("the window takes both minimums, and an absent one is GTK's -1", () => {
		expect(windowPart).toContain(
			"void *shim_window_new(const char *title, int w, int h, int min_w, int min_h)",
		);
		expect(windowPart).toContain(
			"shim_set_size_request(win, min_w > 0 ? min_w : -1, min_h > 0 ? min_h : -1)",
		);
		// The height request is the configured minimum, never the opening height, which
		// would make a 900x600 window impossible to drag shorter.
		expect(windowPart).not.toContain("shim_set_size_request(win, min_w, h)");
		// The FFI declaration must carry the same arity as the prototype above: a
		// four-argument `args` array drops `minHeight` before C ever sees it. The map lives in
		// `shim-symbols.ts`, split out of `shim-ffi.ts` at the line cap.
		const ffi = readFileSync(join(import.meta.dir, "shim-symbols.ts"), "utf8");
		expect(ffi).toContain("shim_window_new: { args: [CS, I32, I32, I32, I32], returns: P }");
	});

	test("the pump reports a native iteration, not whether events were dispatched", () => {
		expect(pump).toContain("shim_context_iterate(0, 0);\n\treturn 1;");
	});

	test("load state is keyed by the webview, not one process-wide slot", () => {
		// The slot that used to answer for whichever view loaded last is gone, and the readers take
		// the handle the commands already carry, so two views in one window answer for themselves.
		expect(viewState).toContain("int shim_webview_load_state(void *web)");
		expect(viewState).toContain("const char *shim_webview_load_text(void *web)");
		expect(viewState).toContain("int shim_webview_eval_state(void *web)");
		expect(viewState).not.toContain("static int shim_load_state;");
		expect(viewState).not.toContain("static int shim_eval_state;");
		// Creation registers the record before any signal can arrive, so a new view at a destroyed
		// view's address cannot inherit its failure.
		expect(webview).toContain("shim_state_register(view)");
		expect(webview).toContain("(void *)shim_state_load_failed");
		// The FFI declarations must carry that argument, or the handle never reaches C.
		const ffi = readFileSync(join(import.meta.dir, "shim-symbols.ts"), "utf8");
		expect(ffi).toContain("shim_webview_load_state: { args: [P], returns: I32 }");
		expect(ffi).toContain("shim_webview_load_text: { args: [P], returns: CS }");
	});

	test("the window holds one positioned container, and the app's page is its main child", () => {
		// A GtkWindow takes one child, so the attach reaches the window's container instead:
		// without this the second webview has nowhere to go, and the first holds the only slot.
		expect(windowPart).toContain("void *box = shim_window_container(win);");
		expect(windowPart).toContain("shim_container_add(box, child);");
		expect(container).toContain('shim_sym(h, "gtk_overlay_new"');
		// The overlay, not a fixed container: its main child follows the allocation, so the app's
		// page resizes with the window without a handler in C.
		expect(container).toContain("shim_container_add(win, box);");
		// A surface is an overlay child placed by points: START alignment plus margins, and a size
		// request only when one was given.
		expect(container).toContain(
			"if (shim_widget_parent(web) != box) shim_overlay_add(box, web);",
		);
		expect(container).toContain("shim_set_margin_start(web, x > 0 ? x : 0)");
		expect(container).toContain("if (w > 0 && h > 0 && shim_set_size_request)");
		// Six arguments, in the order the shim's prototype takes them.
		const ffi = readFileSync(join(import.meta.dir, "shim-symbols.ts"), "utf8");
		expect(ffi).toContain(
			"shim_webview_place: { args: [P, P, I32, I32, I32, I32], returns: I32 }",
		);
		expect(ffi).toContain("shim_window_container: { args: [P], returns: P }");
	});

	test("the keychain binds the synchronous API and never hands GLib memory to Bun", () => {
		const keyring = SHIM_PARTS[10];
		expect(keyring).toContain('shim_open("libsecret-1.so.0")');
		expect(keyring).toContain('shim_sym(shim_secret, "secret_password_storev_sync"');
		expect(keyring).toContain('shim_sym(shim_secret, "secret_password_lookupv_sync"');
		// The lookup copies into a static buffer before returning; no GLib pointer crosses FFI.
		expect(keyring).toContain("static char shim_keyring_value[SHIM_KEYRING_MAX]");
		expect(keyring).toContain("((fn_secret_free)shim_secret_free)(value)");
		expect(keyring).toContain("return truncated ? 0 : shim_keyring_value");
	});
});
