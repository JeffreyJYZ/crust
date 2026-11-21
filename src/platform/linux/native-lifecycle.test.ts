/**
 * Native ownership and async-result guards on the Linux C shim. Split from `shim-source.test.ts` at
 * the 200-line cap: these assertions all guard resources that outlive one command — a snapshot
 * generation, a surface wrapper, a view-state slot — rather than the shim's assembly shape.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SHIM_PARTS } from "./shim-source.ts";

const [prelude, webview, , viewState, windowPart, , host, , , , , , , , , , , snapshot] = SHIM_PARTS;
void prelude;

describe("a late snapshot cannot answer a later capture", () => {
	test("the callback carries its take's generation and a stale one is dropped", () => {
		expect(snapshot).toContain(
			"shim_snapshot_start(web, 0, 0, 0, shim_snapshot_done, (void *)shot_current)",
		);
		expect(snapshot).toContain("if (gen != shot_current) return;");
		expect(snapshot).toContain("unsigned long shim_snapshot_generation(void)");
		expect(snapshot).toContain("unsigned long shim_snapshot_result_generation(void)");
		const ffi = readFileSync(join(import.meta.dir, "shim-symbols.ts"), "utf8");
		expect(ffi).toContain("shim_snapshot_generation: { args: [], returns: I64 }");
		expect(ffi).toContain("shim_snapshot_result_generation: { args: [], returns: I64 }");
	});
});

describe("a closed surface destroys its GtkFixed wrapper and frees its state slot", () => {
	test("close destroys the wrapper before forgetting the slots", () => {
		const close = webview.slice(webview.indexOf("int shim_webview_close("));
		expect(close).toContain("host = shim_webview_host(web)");
		expect(close).toContain("if (host) shim_widget_destroy(host)");
		expect(close).toContain("shim_host_forget(web)");
		expect(close).toContain("shim_state_forget(web)");
	});

	test("a view-state record is compacted away, not left to fill the table", () => {
		expect(viewState).toContain("void shim_state_forget(void *view)");
		expect(viewState).toContain("shim_view_state_count--");
		// The window's own webview has no close call; its destroy signal frees the record.
		expect(windowPart).toContain("shim_window_web[i] = child");
		expect(windowPart).toContain("shim_state_forget(shim_window_web[i])");
	});

	test("a full host table refuses before creating a widget nobody would destroy", () => {
		const place = host.slice(0, host.indexOf("int shim_webview_place("));
		expect(place.indexOf("if (slot < 0) return 0;")).toBeLessThan(
			place.indexOf("host = shim_fixed_new()"),
		);
	});
});
