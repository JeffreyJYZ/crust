/**
 * The pump before the first navigation, read out of the source: this thread has never run a message
 * loop, so WebView2's browser-process state is established by message traffic before `Navigate`. Split
 * from `attach.test.ts` when that file outgrew the line cap.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { lf, readShimSource } from "./shim-source.ts";

const source = readShimSource();
const stages = lf(
	readFileSync(
		join(import.meta.dir, "..", "..", "..", "scripts", "windows", "stages.ts"),
		"utf8",
	),
);

describe("the pump before the first navigation", () => {
	/**
	 * This thread has never run a message loop — it drains only inside `handler_wait`. The canonical sample
	 * navigates from inside a running `GetMessage` loop, so WebView2's browser-process state is established
	 * by message traffic before `Navigate`. The probe prints how many messages the pump drained, and the
	 * product path makes the same call.
	 */
	test("the probe pumps and prints the count", () => {
		expect(stages).toContain('stage("pump_before_navigate", () => shim.shim_pump())');
		expect(stages.indexOf("pump_before_navigate")).toBeLessThan(
			stages.indexOf('stage("webview_navigate"'),
		);
	});

	test("the composite pumps before navigating too", () => {
		const create = source.slice(source.indexOf("int shim_webview_create("));
		const pump = create.indexOf("shim_pump();");
		expect(pump).toBeGreaterThan(-1);
		// The pump lives in the create half, and the navigate comes after it in the composite; a
		// browser surface inserts its handlers between the two, so neither half may swallow the other.
		expect(create.indexOf("return shim_surface_index(hwnd);")).toBeGreaterThan(pump);
		expect(source.slice(source.indexOf("int shim_webview_new("))).toContain(
			"shim_webview_navigate(handle, url)",
		);
	});

	/** An inline controller completion means the webview never saw a pump — the other candidate. */
	test("ctrl_inline is recorded at both create sites and printed", () => {
		// The printers split at the line cap: the object readbacks — `lateReport` among them — live in
		// `report-objects.ts`, and the sequence helpers in `report.ts`.
		const report = lf(
			readFileSync(
				join(import.meta.dir, "..", "..", "..", "scripts", "windows", "report.ts"),
				"utf8",
			) +
				readFileSync(
					join(
						import.meta.dir,
						"..",
						"..",
						"..",
						"scripts",
						"windows",
						"report-objects.ts",
					),
					"utf8",
				),
		);
		expect(source).toContain("int shim_ctrl_inline(void)");
		expect(source.match(/g_ctrl_inline = g_ctrl_handler\.done;/g)?.length).toBe(2);
		expect(report).toContain("shim.shim_ctrl_inline()");
	});
});
