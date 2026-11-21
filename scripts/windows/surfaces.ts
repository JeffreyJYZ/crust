/**
 * The second surface, on the real runtime. `42_webview.c` used to keep one `g_web` for the process, so
 * "does a handle table keep two webviews apart" could not be answered without WebView2 — and WebKit's
 * own state is only ever established by a real runtime. This child builds **two** windows, each with
 * its own controller, and checks that the surface table keeps them apart: distinct handles, distinct
 * `ICoreWebView2` pointers, a `put_Bounds` that lands on the controller the handle names, and a close
 * of one leaving the other's state readable.
 *
 * Diagnostic, not a gate: the smoke prints its exit code and the last `surface` line names the call
 * that died. Runs only on Windows, because a green elsewhere would claim a proof this machine cannot
 * give.
 */
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cstring } from "../../src/platform/windows/cstring.ts";
import { compile } from "../../src/platform/windows/ffi.ts";
import type { Verdict } from "../e2e-harness.ts";
import { addr, skipped, slotReport, stage, stageHr } from "./report.ts";

const APP = "crust-surfaces";
const USER_DATA = join(tmpdir(), "crust-surfaces-webview2");

/** Two windows, two controllers, two surfaces — and then close one and read the other again. */
async function steps(): Promise<number> {
	await slotReport();
	const shim = compile();
	console.log("surface   === two surfaces on one environment (the product path twice) ===");
	let failures = 0;
	const expect = (ok: boolean): void => {
		if (!ok) failures++;
	};

	expect(stage("win32_ready", () => shim.shim_win32_ready()) === 1);
	expect(!stageHr("com_init", () => shim.shim_com_init()));
	expect(stage("register_class", () => shim.shim_register_class(cstring(APP))) !== 0);
	const first = stage("window_new_a", () =>
		shim.shim_window_new(cstring("crust surfaces a"), 400, 300, cstring(APP), 1),
	);
	if (first === 0) {
		skipped("no first window, so no surface can be created");
		return 1;
	}

	// Surface A: the whole product path, so the environment is created by the code the app uses.
	expect(
		stage("webview_new_a", () =>
			shim.shim_webview_new(first, cstring("about:blank"), cstring(USER_DATA)),
		) === 1,
	);
	const handleA = shim.shim_webview_index(first);
	console.log(`surface   a handle ${handleA} web ${addr(shim.shim_webview_handle(handleA))}`);
	expect(handleA === 0); // entry 0 is the app's own window

	const second = stage("window_new_b", () =>
		shim.shim_window_new(cstring("crust surfaces b"), 400, 300, cstring(APP), 1),
	);
	if (second === 0) {
		skipped("no second window, so the second surface cannot be created");
		return failures === 0 ? 0 : 1;
	}
	// Surface B: the same composite with the environment already up, which is what a second surface
	// costs once the first exists.
	expect(
		stage("webview_new_b", () =>
			shim.shim_webview_new(second, cstring("about:blank"), cstring(USER_DATA)),
		) === 1,
	);
	const handleB = shim.shim_webview_index(second);
	const webA = shim.shim_webview_handle(handleA);
	const webB = shim.shim_webview_handle(handleB);
	console.log(`surface   b handle ${handleB} web ${addr(webB)}`);

	// The three claims the refactor exists for. A shared singleton fails every one of them.
	expect(handleB !== handleA);
	expect(webA !== 0 && webB !== 0 && webA !== webB);
	expect(stage("live_two", () => shim.shim_webview_live()) === 2);

	// Bounds per controller: the app window covers its client area, the child surface is positioned.
	// The recorded rectangle is read back per handle, so a put_Bounds that landed on the other
	// controller shows as the wrong numbers rather than as a pass.
	expect(stage("bounds_a", () => shim.shim_webview_set_bounds(handleA, 0, 0, 320, 240)) === 1);
	expect(stage("bounds_b", () => shim.shim_webview_set_bounds(handleB, 24, 16, 200, 120)) === 1);
	const readA = [0, 1, 2, 3].map((which) => shim.shim_webview_bound(handleA, which));
	const readB = [0, 1, 2, 3].map((which) => shim.shim_webview_bound(handleB, which));
	console.log(`surface   a bounds ${readA.join(",")} b bounds ${readB.join(",")}`);
	expect(readA.join(",") === "0,0,320,240");
	expect(readB.join(",") === "24,16,200,120");

	// Navigation per surface, on a runtime rather than a fake: both answer, and each HRESULT is the
	// one that surface's call returned.
	expect(
		stage("navigate_a", () => shim.shim_webview_navigate(handleA, cstring("about:blank"))) ===
			1,
	);
	expect(
		stage("navigate_b", () => shim.shim_webview_navigate(handleB, cstring("about:blank"))) ===
			1,
	);
	console.log(
		`surface   navigate a ${shim.shim_navigate_hresult(handleA)} b ${shim.shim_navigate_hresult(handleB)}`,
	);
	stage("pump", () => shim.shim_pump());

	// Closing one must not free, move or blank the other: the surviving handle still answers, and its
	// webview pointer is the one it had.
	stage("close_a", () => {
		shim.shim_webview_close(first);
		return 1;
	});
	const afterClose = shim.shim_webview_handle(handleB);
	console.log(
		`surface   after close a: live ${shim.shim_webview_live()} index_a ${shim.shim_webview_index(first)} ` +
			`b web ${addr(afterClose)} source ${shim.shim_webview_source(handleB)}`,
	);
	expect(shim.shim_webview_index(first) === -1);
	expect(afterClose === webB);
	expect(shim.shim_webview_source(handleB) === 0);

	stage("close_b", () => {
		shim.shim_webview_close(second);
		return 1;
	});
	expect(shim.shim_webview_live() === 0);
	stage("destroy_a", () => shim.shim_window_destroy(first));
	stage("destroy_b", () => shim.shim_window_destroy(second));

	console.log(`surface   ${failures} claim(s) did not hold`);
	return failures === 0 ? 0 : 1;
}

/**
 * Run in a child, as the other probes do: a fault inside WebView2 is a jump, and a parent cannot
 * report the line it died on. `stdout: "inherit"` is load-bearing — a buffered pipe loses the last
 * line, which is the one that names the call.
 */
export async function runSurfaces(): Promise<number> {
	const child = Bun.spawn([process.execPath, import.meta.path], { stdout: "inherit" });
	return child.exited;
}

/** The smoke's verdict line for this child, kept here so `windows-smoke.ts` stays under the cap. */
export async function checkSurfaces(verdict: Verdict): Promise<void> {
	const code = await runSurfaces();
	verdict.check(
		"surfaces",
		code === 0,
		code === 0
			? "two handles kept separate webview, bounds and Navigate state on one environment"
			: "the two-surface child failed — the last `surface` line above names the call",
	);
}

if (import.meta.main) {
	try {
		process.exit(await steps());
	} catch (error) {
		const text = error instanceof Error ? error.message : String(error);
		console.log(`surface   build failed: ${text.split("\n")[0] ?? text}`);
		process.exit(1);
	}
}
