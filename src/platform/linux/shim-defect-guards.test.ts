/**
 * Source-level guards for the C shim. This machine has no GTK/WebKitGTK, so none of these run the
 * native code: they pin the shape the JS layer relies on after the read-only hunt-22 findings.
 * Runtime proof stays with the ubuntu smoke; these fail in CI on any checkout that regresses.
 */
import { describe, expect, test } from "bun:test";
import { SHIM_PARTS } from "./shim-source.ts";

const [prelude, webview, browser, viewState, windowPart, container, host] = SHIM_PARTS;
void prelude;
void webview;
void browser;
void viewState;

describe("native defect guards (read source, no GTK)", () => {
	test("a window with no free slot is destroyed, never returned untracked", () => {
		expect(windowPart).toContain(
			"if (slot < 0 && shim_slot_count < 32) slot = shim_slot_count++;",
		);
		expect(windowPart).toContain("if (slot < 0) {");
		expect(windowPart).toContain("if (shim_destroy) shim_destroy(win);\n\t\treturn 0;");
		expect(windowPart).not.toContain("if (slot >= 0) {");
	});

	test("place resolves the resize pointer itself, not only on proof readbacks", () => {
		expect(host).toContain("shim_container_resolve_reads();");
		expect(container).toContain('shim_sym_or_null(h, "gtk_widget_queue_resize")');
		expect(host).toContain("if (shim_queue_resize) shim_queue_resize(host);");
		expect(host).toContain("if (shim_queue_resize) shim_queue_resize(box);");
	});

	test("destroying a host window frees its surface slots and view records", () => {
		expect(container).toContain("void *shim_box_window(void *box)");
		expect(host).toContain("static void *shim_host_win[SHIM_BOX_MAX]");
		expect(host).toContain("void shim_host_forget_window(void *win)");
		expect(host).toContain("shim_state_forget(shim_host_view[i])");
		expect(host).toContain("shim_host_win[slot] = win");
		expect(windowPart).toContain("shim_host_forget_window(widget)");
		expect(windowPart).toContain("shim_host_forget_window(win)");
	});
});
