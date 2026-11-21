/**
 * Mode 3 of the Windows probe: **exactly what `window-open.ts` does, and nothing more** — one window,
 * one `shim_webview_new`, a few pump slices, then liveness. No per-step probes and no explicit
 * `NavigateToString`, because the composite decides what it calls: a green here is the product path's
 * own, and a green only in modes 1/2 would mean the probe was warming the webview for it.
 *
 * Split from `stages.ts` when that file outgrew the line cap.
 */
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cstring } from "../../src/platform/windows/cstring.ts";
import { compile } from "../../src/platform/windows/ffi.ts";
import { addr, hex, skipped, slotReport, stage, stageHr } from "./report.ts";

const APP = "crust-composite";
const USER_DATA = join(tmpdir(), "crust-composite-webview2");
/**
 * Mode 3: **exactly what `window-open.ts` does, and nothing more** — one window, one
 * `shim_webview_new`, a few pump slices, then liveness. No per-step probes and no explicit
 * `NavigateToString`: the composite decides what it calls, so a green here is the product path's own.
 */
export async function compositeSteps(): Promise<number> {
	await slotReport();
	const shim = compile();
	console.log("stage     === composite mode 3 (the product path only) ===");
	let failures = 0;
	const expect = (ok: boolean): void => {
		if (!ok) failures++;
	};

	expect(stage("win32_ready", () => shim.shim_win32_ready()) === 1);
	expect(!stageHr("com_init", () => shim.shim_com_init()));
	expect(stage("register_class", () => shim.shim_register_class(cstring(APP))) !== 0);
	const hwnd = stage("window_new", () =>
		shim.shim_window_new(cstring("crust composite"), 480, 320, cstring(APP), 1),
	);
	if (hwnd === 0) {
		skipped("no window, so the composite cannot run");
		return 1;
	}

	// The one call the product makes for the whole WebView2 path.
	expect(
		stage("webview_new", () =>
			shim.shim_webview_new(hwnd, cstring("about:blank"), cstring(USER_DATA)),
		) === 1,
	);
	// A few slices, as `platform.pump` would after `openWindows` returns.
	for (let slice = 0; slice < 4; slice++) stage(`pump_${slice}`, () => shim.shim_pump());
	expect(stage("is_open", () => shim.shim_window_is_open(hwnd)) === 1);
	expect(shim.shim_webview_handle() !== 0);
	console.log(
		`stage     composite webview ${addr(shim.shim_webview_handle())} navigate ${hex(
			shim.shim_navigate_hresult(),
		)} ctrl_from ${shim.shim_ctrl_from()} ctrl_inline ${shim.shim_ctrl_inline()}`,
	);
	stage("destroy", () => shim.shim_window_destroy(hwnd));
	console.log(`stage     ${failures} step(s) did not answer`);
	return failures === 0 ? 0 : 1;
}
