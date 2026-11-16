/**
 * The step-by-step probe: every shim call the window path makes, one line each, printed *before* the
 * call so a crash leaves the name of the call that killed the process rather than nothing at all.
 *
 * This exists because three runs died silently in the middle of `createWindow`. One child process,
 * stdout inherited, so the last line is already on the terminal when the process dies — no buffer to
 * lose.
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
 * The handler object as Windows will read it: the first field must be the table, and each entry must
 * be a real function. A table entry that is `0xffffffff` is the jump this layer keeps dying on.
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
function steps(): number {
	const shim = compile();
	handlerReport(shim);

	if (stage("win32_ready", () => shim.shim_win32_ready()) !== 1) return 1;
	if (stage("com_init", () => shim.shim_com_init()) < 0) return 1;
	if (stage("register_class", () => shim.shim_register_class(cstring(APP))) === 0) return 1;

	const hwnd = stage("window_new", () =>
		shim.shim_window_new(cstring("crust stages"), 480, 320, cstring(APP)),
	);
	if (hwnd === 0) return 1;
	stage("client_width", () => shim.shim_window_client_num(hwnd, 2));
	stage("client_height", () => shim.shim_window_client_num(hwnd, 3));

	// The environment: the call, the wait, and the HRESULT the callback carried. These are three
	// different failures — a refused call, a callback that never arrived, a callback that failed.
	if (stage("env_begin", () => shim.shim_env_begin(cstring(USER_DATA))) < 0) return 1;
	if (stage("env_wait", () => shim.shim_env_wait()) === 0) return 1;
	if (stage("env_callback", () => shim.shim_env_callback()) < 0) return 1;

	// The controller, the same three questions.
	if (stage("controller_begin", () => shim.shim_controller_begin(hwnd)) < 0) return 1;
	if (stage("controller_wait", () => shim.shim_controller_wait()) === 0) return 1;
	if (stage("controller_callback", () => shim.shim_controller_callback()) < 0) return 1;

	// The vtable slots: get_CoreWebView2, put_Bounds (a 16-byte struct by reference), Navigate.
	if (stage("webview_attach", () => shim.shim_webview_attach(hwnd)) === 0) return 1;
	if (stage("webview_navigate", () => shim.shim_webview_navigate(cstring("about:blank"))) === 0) {
		return 1;
	}

	stage("pump", () => shim.shim_pump());
	stage("set_title", () => shim.shim_window_set_title(hwnd, cstring("crust stages 2")));
	stage("is_open", () => shim.shim_window_is_open(hwnd));
	stage("webview_close", () => {
		shim.shim_webview_close(hwnd);
		return 1;
	});
	stage("destroy", () => shim.shim_window_destroy(hwnd));
	return 0;
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
		process.exit(steps());
	} catch (error) {
		const text = error instanceof Error ? error.message : String(error);
		console.log(`stage     build failed: ${text.split("\n")[0] ?? text}`);
		process.exit(1);
	}
}
