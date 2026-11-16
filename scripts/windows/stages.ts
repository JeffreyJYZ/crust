/**
 * The step-by-step probe: every shim call the window path makes, one line each, printed *before* the
 * call so a crash leaves the name of the call that killed the process rather than nothing at all.
 *
 * Two rules, both learned from seven runs that each hid the next defect:
 *
 * 1. **Never stop at the first bad answer.** A refusal, a callback that never came and a wrong object
 *    are three findings, and one run has to carry all of them. Only a *prerequisite* failure skips the
 *    stages that depend on it, and it prints `skipped: <reason>` so the absence is visible.
 * 2. **Print the pointers before they are dereferenced.** `shim_slot_ok` refuses a vtable entry that is
 *    `0`, `(void *)-1` or not committed executable memory, so a bad object becomes an HRESULT and a
 *    printed number instead of a jump to `0xffffffffffffffff`.
 *
 * Diagnostic, not a gate: the smoke prints the exit code and carries on.
 */
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cstring } from "../../src/platform/windows/cstring.ts";
import { compile } from "../../src/platform/windows/ffi.ts";
import {
	addr,
	affinityReport,
	handlerReport,
	lateReport,
	hex,
	objectReport,
	slotReport,
	threadReport,
	webReport,
} from "./report.ts";

const APP = "crust-stages";
const USER_DATA = join(tmpdir(), "crust-stages-webview2");

/** Print the call about to be made, then its answer. A crash leaves the first half as the last line. */
function stage(name: string, call: () => number): number {
	console.log(`stage     ${name} …`);
	const value = Number(call());
	console.log(`stage     ${name} ok ${value}`);
	return value;
}

/**
 * An HRESULT stage. Printed raw *and* as hex, because a reader has to be able to decode it, and scored
 * by the sign of its low 32 bits: `0x802A000C` arrives zero-extended as `2150236172`, which a plain
 * `< 0` reads as a pass — that is how a failing `controller_begin` was once counted as a success.
 */
function stageHr(name: string, call: () => number): boolean {
	console.log(`stage     ${name} …`);
	const value = Number(call());
	console.log(`stage     ${name} ok ${value} (${hex(value)})`);
	return (value | 0) < 0;
}

/** One line that says why the rest of the run is missing, so an absence is never silent. */
function skipped(reason: string): void {
	console.log(`stage     skipped: ${reason}`);
}

/** Every call from a cold start to a navigated window, in the order the platform makes them. */
async function steps(): Promise<number> {
	await slotReport();
	const shim = compile();
	handlerReport(shim);

	let failures = 0;
	const expect = (ok: boolean): void => {
		if (!ok) failures++;
	};

	expect(stage("win32_ready", () => shim.shim_win32_ready()) === 1);
	expect(!stageHr("com_init", () => shim.shim_com_init()));
	expect(stage("register_class", () => shim.shim_register_class(cstring(APP))) !== 0);

	const hwnd = stage("window_new", () =>
		shim.shim_window_new(cstring("crust stages"), 480, 320, cstring(APP)),
	);
	expect(hwnd !== 0);
	if (hwnd === 0) {
		skipped("no window, so nothing below it can be created");
		return failures === 0 ? 0 : 1;
	}
	stage("client_width", () => shim.shim_window_client_num(hwnd, 2));
	stage("client_height", () => shim.shim_window_client_num(hwnd, 3));
	threadReport(shim);

	// The environment: the call, whether its callback fired on that call's own stack, the wait, and the
	// HRESULT the callback carried. Four different failures, four numbers.
	expect(!stageHr("env_begin", () => shim.shim_env_begin(hwnd, cstring(USER_DATA))));
	console.log(
		`stage     env_inline ${shim.shim_env_inline()} (1 = the callback ran inside create_env)`,
	);
	expect(stage("env_wait", () => shim.shim_env_wait()) === 1);
	expect(!stageHr("env_callback", () => shim.shim_env_callback()));
	threadReport(shim);

	// Affinity and the object, both printed *before* the controller call.
	affinityReport(shim, hwnd);
	objectReport(shim);
	expect(!stageHr("controller_begin", () => shim.shim_controller_begin(hwnd)));
	expect(stage("controller_wait", () => shim.shim_controller_wait()) === 1);
	expect(!stageHr("controller_callback", () => shim.shim_controller_callback()));
	threadReport(shim);
	objectReport(shim);

	if (shim.shim_controller_addr() === 0) {
		skipped("no controller, so bind, size and navigate cannot run");
		return failures === 0 ? 0 : 1;
	}

	// The two calls that can still jump: get_CoreWebView2 (slot 25) and put_Bounds (slot 6, by reference).
	expect(stage("webview_bind", () => shim.shim_webview_bind(hwnd)) === 1);
	console.log(
		`stage     web ${addr(shim.shim_webview_handle())} get_CoreWebView2 ${hex(
			shim.shim_attach_hresult(0),
		)} put_IsVisible ${hex(shim.shim_attach_hresult(2))}`,
	);
	expect(stage("webview_size", () => shim.shim_webview_size(hwnd)) === 1);
	console.log(`stage     put_Bounds ${hex(shim.shim_attach_hresult(1))}`);

	if (shim.shim_webview_handle() === 0) {
		skipped("no ICoreWebView2, so navigate, title, liveness and close cannot run");
		return failures === 0 ? 0 : 1;
	}
	webReport(shim);

	// Two calls whose answers separate "the object is unusable" from "Navigate is the fault": a trivial
	// getter on the webview, and the visibility call every sample makes and this layer never has.
	expect(!stageHr("webview_source", () => shim.shim_webview_source()));
	expect(!stageHr("controller_visible", () => shim.shim_controller_visible()));

	// The thread has never run a message loop, so pump before the first navigation and print how many
	// messages that drained: WebView2's browser-process state is established by message traffic.
	console.log(
		`stage     pump_before_navigate ok ${stage("pump_before_navigate", () => shim.shim_pump())}`,
	);
	// Immediately before the call that faulted with a perfect-looking vtable, and its answer after it.
	console.log(
		`stage     navigate about:blank vtable ${addr(shim.shim_webview_vtbl())} slot5 ${addr(
			shim.shim_webview_slot(5),
		)}`,
	);
	expect(
		stage("webview_navigate", () => shim.shim_webview_navigate(cstring("about:blank"))) === 1,
	);
	console.log(`stage     navigate hresult ${hex(shim.shim_navigate_hresult())}`);

	stage("pump", () => shim.shim_pump());
	stage("set_title", () => shim.shim_window_set_title(hwnd, cstring("crust stages 2")));
	expect(stage("is_open", () => shim.shim_window_is_open(hwnd)) === 1);
	stage("webview_close", () => {
		shim.shim_webview_close(hwnd);
		return 1;
	});
	expect(stage("destroy", () => shim.shim_window_destroy(hwnd)) === 1);

	console.log(`stage     ${failures} step(s) did not answer`);
	return failures === 0 ? 0 : 1;
}

/**
 * Run the probe in a child and report how it ended. `stdout: "inherit"` is load-bearing: a buffered
 * pipe would lose the line that names the call when the child dies.
 */
export async function runStages(): Promise<{ code: number }> {
	const child = Bun.spawn([process.execPath, import.meta.path], { stdout: "inherit" });
	return { code: await child.exited };
}

if (import.meta.main) {
	try {
		process.exit(await steps());
	} catch (error) {
		const text = error instanceof Error ? error.message : String(error);
		console.log(`stage     build failed: ${text.split("\n")[0] ?? text}`);
		process.exit(1);
	}
}
