/**
 * The step-by-step probe: every shim call the window path makes, one line each, printed *before* the
 * call so a crash leaves the name of the call that killed the process rather than nothing at all.
 *
 * This exists because two runs died silently in the middle of `createWindow` and the log could only
 * say "after `com + class`". One child process, stdout inherited, so the last line is already on the
 * terminal when the process dies — no buffer to lose.
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

/** Every call from a cold start to a navigated window, in the order the platform makes them. */
function steps(): number {
	const shim = compile();
	if (stage("win32_ready", () => shim.shim_win32_ready()) !== 1) return 1;
	if (stage("com_init", () => shim.shim_com_init()) < 0) return 1;
	if (stage("register_class", () => shim.shim_register_class(cstring(APP))) === 0) return 1;

	const hwnd = stage("window_new", () =>
		shim.shim_window_new(cstring("crust stages"), 480, 320, cstring(APP)),
	);
	if (hwnd === 0) return 1;

	// The two client-rect reads and the controller both run before the first bounds call, so each
	// gets its own line: a fault in the rect struct and a fault in COM are different bugs.
	stage("client_width", () => shim.shim_window_client_num(hwnd, 2));
	stage("client_height", () => shim.shim_window_client_num(hwnd, 3));
	// The environment and the controller are separate COM waits inside this one call; if this line
	// is the last one printed, the fault is in one of the two completion handlers.
	if (
		stage("webview_new", () =>
			shim.shim_webview_new(hwnd, cstring("about:blank"), cstring(USER_DATA)),
		) === 0
	) {
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
	process.exit(steps());
}
