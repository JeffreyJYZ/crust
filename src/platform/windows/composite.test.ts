/**
 * Mode 3 of the Windows probe: the product path and nothing else. Modes 1 and 2 call
 * `NavigateToString` themselves, so a green there may be the probe warming the webview for it — this
 * mode is what settles whether the app's own call works.
 *
 * Split from `attach.test.ts` when that file outgrew the line cap.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { lf } from "./shim-source.ts";

const stages = lf(
	readFileSync(
		join(import.meta.dir, "..", "..", "..", "scripts", "windows", "stages.ts"),
		"utf8",
	),
);
describe("the composite mode proves the product path, not the probe's", () => {
	/**
	 * Modes 1 and 2 call `NavigateToString` themselves before `Navigate`, so a green there may be the probe
	 * warming the webview. Mode 3 does what `window-open.ts` does and nothing else: one `shim_webview_new`,
	 * then a few pump slices. A green only in 1/2 would mean the app path still faults.
	 */
	test("mode 3 makes the product call and no per-step probes", () => {
		const composite = readFileSync(
			join(import.meta.dir, "..", "..", "..", "scripts", "windows", "composite.ts"),
			"utf8",
		);
		expect(composite).toContain("shim.shim_webview_new(hwnd");
		expect(composite).not.toContain("shim_webview_navigate_string");
		expect(composite).not.toContain("shim.shim_webview_source");
		expect(composite).not.toContain("shim.shim_controller_visible");
		// Liveness and the handle, after a few slices, exactly as the smoke asserts them.
		expect(composite).toContain("shim.shim_window_is_open(hwnd)");
		expect(composite).toContain("shim.shim_webview_handle() !== 0");
		expect(stages).toContain('["1", "2", "3"]');
	});
});
