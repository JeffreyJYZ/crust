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
		expect(windowPart).toContain("if (slot < 0 && shim_slot_count < 32) slot = shim_slot_count++;");
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
});
