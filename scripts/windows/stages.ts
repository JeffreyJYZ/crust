/**
 * The step-by-step probe: every shim call the window path makes, one line each, printed *before* the
 * call so a crash leaves the name of the call that killed the process rather than nothing at all.
 *
 * This exists because four runs died or refused silently in the middle of `createWindow`. One child
 * process, stdout inherited, so the last line is already on the terminal when the process dies — no
 * buffer to lose.
 *
 * It does not stop at the first bad answer: a refused call, a callback that never arrived and a
 * callback that carried a failure are three different defects, and one run has to report all three.
 *
 * Diagnostic, not a gate: the smoke prints the exit code and carries on, because a probe that does
 * what it was built to catch must not be the thing that reddens the build.
 */
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cstring } from "../../src/platform/windows/cstring.ts";
import { compile } from "../../src/platform/windows/ffi.ts";

const APP = "crust-stages";
const USER_DATA = join(tmpdir(), "crust-stages-webview2");

/** Print the call about to be made, then its answer. A crash leaves the first half as the last line. */
function stage(name: string, call: () => number): number {
	console.log(`stage     ${name} …`);
	const value = Number(call());
	console.log(`stage     ${name} ok ${value}`);
	return value;
}

/** A pointer or an HRESULT as hex, because both are read as bit patterns. */
function hex(value: number): string {
	return `0x${(value >>> 0).toString(16).padStart(8, "0")}`;
}

/**
 * The slot index each call uses, read out of the prelude beside the method it belongs to — so a wrong
 * index is a printed number next to its method name, not something inferred from a crash.
 */
async function slotReport(): Promise<void> {
	const path = join(import.meta.dir, "../../src/platform/windows/shim/10_prelude.c");
	const text = await Bun.file(path).text();
	const found = [...text.matchAll(/#define (SHIM_SLOT_\w+) (\d+)/g)];
	console.log(`stage     slots ${found.map((match) => `${match[1]}=${match[2]}`).join(" ")}`);
}

/** Which thread each step ran on. `UI_E_WRONG_THREAD` is exactly what a mismatch here looks like. */
function threadReport(shim: ReturnType<typeof compile>): void {
	const names = ["com", "env_call", "env_callback", "ctrl_call", "ctrl_callback"];
	const seen = names.map((name, index) => `${name} ${shim.shim_thread_at(index)}`);
	console.log(`stage     threads ${seen.join(" ")} now ${shim.shim_thread_id()}`);
}

/**
 * The handler object as Windows will read it: the first field must be the table, and each entry must
 * be a real function. A table entry that is `0xffffffff` is the jump this layer kept dying on.
 */
function handlerReport(shim: ReturnType<typeof compile>): void {
	stage("handler_prepare", () => shim.shim_handler_prepare());
	console.log(
		`stage     handler vtbl ${hex(shim.shim_handler_vtbl_addr())} object ${hex(
			shim.shim_handler_object_addr(),
		)} first ${hex(shim.shim_handler_first_field())}`,
	);
	for (let index = 0; index < 8; index++) {
		console.log(`stage     handler entry ${index} ${hex(shim.shim_handler_entry(index))}`);
	}
}

/** Every call from a cold start to a navigated window, in the order the platform makes them. */
async function steps(): Promise<number> {
	await slotReport();
	const shim = compile();
	handlerReport(shim);

	/** 1 for every answer that is not what the caller needs, so the exit code still means something. */
	let failures = 0;

	failures += stage("win32_ready", () => shim.shim_win32_ready()) === 1 ? 0 : 1;
	failures += expectHr(
		"com_init",
		stage("com_init", () => shim.shim_com_init()),
	);
	failures += stage("register_class", () => shim.shim_register_class(cstring(APP))) === 0 ? 1 : 0;

	const hwnd = stage("window_new", () =>
		shim.shim_window_new(cstring("crust stages"), 480, 320, cstring(APP)),
	);
	if (hwnd === 0) failures++;
	stage("client_width", () => shim.shim_window_client_num(hwnd, 2));
	stage("client_height", () => shim.shim_window_client_num(hwnd, 3));
	threadReport(shim);

	// The environment: the call, the wait, and the HRESULT the callback carried. The controller is
	// built *inside* that callback, so `controller_begin` below is the fallback that must create
	// nothing.
	failures += expectHr(
		"env_begin",
		stage("env_begin", () => shim.shim_env_begin(hwnd, cstring(USER_DATA))),
	);
	failures += stage("env_wait", () => shim.shim_env_wait()) === 1 ? 0 : 1;
	failures += expectHr(
		"env_callback",
		stage("env_callback", () => shim.shim_env_callback()),
	);
	threadReport(shim);

	// The controller, the same three questions. `UI_E_WRONG_THREAD` (0x802A000C) is what the begin
	// call answered on the runner, so the thread lines are the measurement that matters.
	failures += expectHr(
		"controller_begin",
		stage("controller_begin", () => shim.shim_controller_begin(hwnd)),
	);
	failures += stage("controller_wait", () => shim.shim_controller_wait()) === 1 ? 0 : 1;
	failures += expectHr(
		"controller_callback",
		stage("controller_callback", () => shim.shim_controller_callback()),
	);
	threadReport(shim);
	// Affinity, as two numbers: the thread that owns the window, and the thread the controller call was
	// made on. Different means the window is the culprit; equal with apartment 0 means both halves are
	// same-thread STA and the "object" in the message is WebView2-internal.
	console.log(
		`stage     window_thread ${shim.shim_window_thread(hwnd)} controller_thread ${shim.shim_thread_at(3)}`,
	);
	console.log(`stage     apartment ${shim.shim_apartment_type()}`);

	// The vtable slots: get_CoreWebView2, put_Bounds (a 16-byte struct by reference), Navigate.
	failures += stage("webview_attach", () => shim.shim_webview_attach(hwnd)) === 1 ? 0 : 1;
	failures +=
		stage("webview_navigate", () => shim.shim_webview_navigate(cstring("about:blank"))) === 1
			? 0
			: 1;

	stage("pump", () => shim.shim_pump());
	stage("set_title", () => shim.shim_window_set_title(hwnd, cstring("crust stages 2")));
	stage("is_open", () => shim.shim_window_is_open(hwnd));
	stage("webview_close", () => {
		shim.shim_webview_close(hwnd);
		return 1;
	});
	stage("destroy", () => shim.shim_window_destroy(hwnd));

	console.log(`stage     ${failures} step(s) did not answer`);
	return failures === 0 ? 0 : 1;
}

/** A stage whose value is an HRESULT: anything negative is a failure, and it is already printed. */
function expectHr(name: string, value: number): number {
	void name;
	return value < 0 ? 1 : 0;
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
