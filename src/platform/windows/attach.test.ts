/**
 * The attach on the product path, and the two calls that separate "the object is unusable" from "the call
 * is". Both are read out of the source because nothing here can execute on a Mac.
 *
 * Split from `guard.test.ts` when that file outgrew the line cap.
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

describe("the probe separates the object from the call", () => {
	/**
	 * `Navigate` faulted with a vtable whose slots 3/4/5/6 were four distinct real code addresses. The
	 * question is binary — is the object callable, or is the call — and two cheap calls answer it: a
	 * getter on the webview, and the visibility call every sample makes and this layer never has.
	 */
	test("get_Source and put_IsVisible run before Navigate", () => {
		expect(source).toContain("int wv2_get_source(void *web)");
		expect(source).toContain("int wv2_put_visible(void *ctrl, int visible)");
		expect(stages).toContain('stageHr("webview_source"');
		expect(stages).toContain('stageHr("controller_visible"');
		expect(stages.indexOf("webview_source")).toBeLessThan(
			stages.indexOf('stage("webview_navigate"'),
		);
		// The BSTR get_Source answers is leaked on purpose: the probe reads only the HRESULT.
		expect(source).toContain("The string is deliberately");
	});

	/** A truncated pointer in the line meant to identify the object is the same defect twice. */
	test("every pointer in the probe is printed in full", () => {
		expect(stages).not.toContain("web ${hex(");
		expect(stages).toContain("web ${addr(");
		expect(stages).toContain("navigate about:blank vtable");
	});
});

describe("the product path makes the controller visible", () => {
	/**
	 * `get_IsVisible` starts FALSE and a controller that is never made visible renders nothing — so this is
	 * not a probe nicety, it is the difference between a green smoke and an app with a blank window. It sits
	 * in `shim_webview_bind`, after `get_CoreWebView2` and before `put_Bounds`, which is the canonical
	 * position and the one both the composite and the probe reach.
	 */
	test("put_IsVisible runs on the product path, before put_Bounds", () => {
		const bind = source.slice(
			source.indexOf("int shim_webview_bind(shim_h hwnd) {"),
			source.indexOf("\n}", source.indexOf("int shim_webview_bind(shim_h hwnd) {")),
		);
		expect(bind).toContain("wv2_put_visible(ctrl, 1)");
		expect(bind.indexOf("wv2_controller_webview(ctrl, &web)")).toBeLessThan(
			bind.indexOf("wv2_put_visible(ctrl, 1)"),
		);

		const attach = source.slice(source.indexOf("int shim_webview_attach(shim_h hwnd) {"));
		expect(attach.indexOf("shim_webview_bind(hwnd)")).toBeLessThan(
			attach.indexOf("shim_webview_size(hwnd)"),
		);
		// The composite the platform calls goes through attach, so it cannot miss the call.
		const composite = source.slice(source.indexOf("int shim_webview_new("));
		expect(composite).toContain("shim_webview_attach(hwnd)");
	});

	test("its HRESULT is recorded beside the other two", () => {
		expect(source).toContain("g_visible_hr = wv2_put_visible(ctrl, 1);");
		const report = source.slice(source.indexOf("shim_i64 shim_attach_hresult(int which) {"));
		expect(report.slice(0, report.indexOf("\n}"))).toContain("g_visible_hr");
		// One mechanism, not a parallel one.
		expect(stages).toContain("shim.shim_attach_hresult(2)");
	});
});

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
		const composite = source.slice(source.indexOf("int shim_webview_new("));
		const pump = composite.indexOf("shim_pump();");
		const navigate = composite.indexOf("shim_webview_navigate(url)");
		expect(pump).toBeGreaterThan(-1);
		expect(navigate).toBeGreaterThan(-1);
		expect(pump).toBeLessThan(navigate);
	});

	/** An inline controller completion means the webview never saw a pump — the other candidate. */
	test("ctrl_inline is recorded at both create sites and printed", () => {
		const report = lf(
			readFileSync(
				join(import.meta.dir, "..", "..", "..", "scripts", "windows", "report.ts"),
				"utf8",
			),
		);
		expect(source).toContain("int shim_ctrl_inline(void)");
		expect(source.match(/g_ctrl_inline = g_ctrl_handler\.done;/g)?.length).toBe(2);
		expect(report).toContain("shim.shim_ctrl_inline()");
	});
});

describe("the next run tests the controller shape, not just measures it", () => {
	/**
	 * `ctrl_inline` decides whether the fault is ours or WebView2's, so it has to print *before* the call
	 * that faults — it used to be in the late report, which the one run that needed it never reached.
	 */
	test("ctrl_inline prints before Navigate", () => {
		expect(stages).toContain("shim.shim_ctrl_inline()");
		expect(stages.indexOf("shim.shim_ctrl_inline()")).toBeLessThan(
			stages.indexOf('stage("webview_navigate"'),
		);
	});

	/** The helper prints the count; wrapping it in a template printed the line twice. */
	test("the pump count is printed once", () => {
		expect(stages).not.toContain("pump_before_navigate ok ${stage(");
		expect(stages.match(/stage\("pump_before_navigate"/g)?.length).toBe(1);
	});

	/**
	 * `shim_controller_begin` answered UI_E_WRONG_THREAD once, before AddRef — that error was a dangling
	 * environment, not a thread. The probe now runs one child per shape, so the move is tested without
	 * changing the product path.
	 */
	test("both shapes are selectable, and the product path keeps the deferral", () => {
		expect(source).toContain("int shim_ctrl_mode(int mode)");
		expect(source).toContain("int g_ctrl_mode = 1;");
		// The setter has to assign, or the probe's "mode 2" child silently runs the deferral again.
		expect(source).toContain("if (mode == 1 || mode == 2) g_ctrl_mode = mode;");
		expect(source).toContain("if (g_ctrl_mode == 2) return;");
		expect(source).toContain("int shim_ctrl_mode(int mode) {");
		expect(stages).toContain('for (const mode of ["1", "2"])');
		expect(stages).toContain("shim.shim_ctrl_mode(mode)");
	});
});
