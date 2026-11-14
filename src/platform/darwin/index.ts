/**
 * macOS platform implementation: AppKit over `bun:ffi`, no native artifact. Ported from the M0 spike (window visible at 299.5 ms, webview 165 ms, page 925 ms, two resizes survived); `site/app/docs/design/page.mdx` explains the shim and the pump.
 * Every selector is preflighted once, because an uncaught Objective-C exception terminates the process with SIGABRT and no JavaScript error; no JS string passes into C — `const char *` gets an encoded buffer and every object stays native-side as an opaque pointer. The `cc()` declaration stays in this file because `arity.test.ts` compares it against the shim parts.
 */

import { cc, FFIType } from "bun:ffi";
import { createHash } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Shim } from "./shim-symbols.ts";

// Inside a compiled binary `import.meta.dir` is `/$bunfs/root`, where the .c file
// does not exist. The shim therefore travels inside the binary as text and is
// materialised to a temp file before `cc()` is called.
import { shimSource } from "./shim-source.ts";

const P = FFIType.ptr;
const I32 = FFIType.i32;
const I64 = FFIType.i64;
const F64 = FFIType.f64;
const V = FFIType.void;
const CS = FFIType.cstring;

/** Compile the shipped C shim. `cc()` compiles C only, and a framework must be linked. */
function compile() {
	/** Materialise the embedded shim and return its path. Content-hashed, so a
	 * second launch reuses the same file and TinyCC's per-path cache. */
	function shimPath(): string {
		const hash = createHash("sha256").update(shimSource).digest("hex").slice(0, 16);
		const path = join(tmpdir(), `crust-shim-${hash}.c`);
		if (!existsSync(path)) writeFileSync(path, shimSource);
		return path;
	}

	return cc({
		source: shimPath(),
		flags: [
			"-framework",
			"AppKit",
			"-framework",
			"Foundation",
			"-framework",
			"WebKit",
			"-framework",
			"CoreFoundation",
		],
		symbols: {
			shim_cls: { args: [P], returns: P },
			shim_sel: { args: [P], returns: P },
			shim_object_class: { args: [P], returns: P },
			shim_class_name: { args: [P], returns: CS },
			shim_name_of_class: { args: [P], returns: CS },
			shim_instance_method: { args: [P, P], returns: P },
			shim_responds: { args: [P, P], returns: I32 },

			shim_send_p0: { args: [P, P], returns: P },
			shim_send_p1: { args: [P, P, P], returns: P },
			shim_send_p2: { args: [P, P, P, P], returns: P },
			shim_send_p3: { args: [P, P, P, P, P], returns: P },
			shim_send_pq1: { args: [P, P, I64], returns: P },
			shim_send_pd1: { args: [P, P, F64], returns: P },
			shim_send_pb1: { args: [P, P, I32], returns: P },

			shim_send_b0: { args: [P, P], returns: I32 },
			shim_send_b1: { args: [P, P, P], returns: I32 },
			shim_send_q0: { args: [P, P], returns: I64 },
			shim_send_q1: { args: [P, P, I64], returns: I64 },

			shim_send_v0: { args: [P, P], returns: V },
			shim_send_v1: { args: [P, P, P], returns: V },
			shim_send_v2: { args: [P, P, P, P], returns: V },
			shim_send_vb1: { args: [P, P, I32], returns: V },
			shim_send_vq1: { args: [P, P, I64], returns: V },
			shim_send_vd1: { args: [P, P, F64], returns: V },

			shim_new: { args: [P], returns: P },
			shim_cstr_len: { args: [P], returns: I64 },
			shim_webview_load: { args: [P, P], returns: I32 },

			shim_constraint: { args: [P, I64, I64, P, I64, F64, F64], returns: P },
			shim_constraint_simple: { args: [P, I64, I64, F64], returns: P },
			shim_frame_num: { args: [P, I32], returns: F64 },
			shim_window_new: { args: [F64, F64, F64, F64, I64, I64, I32], returns: P },
			shim_window_set_min_size: { args: [P, F64, F64], returns: V },
			shim_window_set_title: { args: [P, P], returns: V },
			shim_window_title_utf8: { args: [P], returns: CS },
			shim_window_number: { args: [P], returns: I64 },
			shim_window_is_visible: { args: [P], returns: I32 },
			shim_window_is_released_when_closed: { args: [P], returns: I32 },
			shim_window_is_key: { args: [P], returns: I32 },
			shim_window_is_miniaturized: { args: [P], returns: I32 },

			shim_on_main_runloop: { args: [], returns: I32 },
			shim_window_is_on_active_space: { args: [P], returns: I32 },

			shim_app_load: { args: [], returns: I32 },
			shim_pool_new: { args: [], returns: P },
			shim_pool_init: { args: [P], returns: P },
			shim_pool_drain: { args: [P], returns: V },

			shim_mode: { args: [], returns: P },
			shim_mode_ok: { args: [P], returns: I32 },
			shim_pump: { args: [P], returns: I32 },

			// The open panel: an int status in, and the chosen paths read back
			// one at a time as C strings. No object and no struct crosses. The
			// save panel shares the storage and the status set.
			shim_open_panel: { args: [P, P, I32, I32, I32], returns: I32 },
			shim_open_panel_count: { args: [], returns: I32 },
			shim_open_panel_path: { args: [I32], returns: CS },
			// title, suggested file name, filter list, runModal.
			shim_save_panel: { args: [P, P, P, I32], returns: I32 },

			// The sheet's answer, polled while the pump keeps running. -cancel:
			// is the page's way to end a sheet with no human; -kind names the
			// panel that is up, so a second request can say which one refused it.
			shim_sheet_done: { args: [], returns: I32 },
			shim_sheet_response: { args: [], returns: I64 },
			shim_sheet_cancel: { args: [], returns: I32 },
			shim_sheet_kind: { args: [], returns: I32 },
		},
	}) as unknown as Shim;
}

let shimOnce: Shim | undefined;
/** Compile the shim at most once per process; `cc()` takes 3–20 ms. */
export function shim(): Shim {
	return (shimOnce ??= compile());
}

// --- public surface --------------------------------------------------------

export type { Shim } from "./shim-symbols.ts";
export { darwinDialogAdapter, type DarwinDialogAdapter } from "./dialog.ts";
export { windowLiveness, type WindowLivenessState } from "./liveness.ts";
export { darwinPanelShim, extensionList, type PanelShim } from "./panel-shim.ts";
export {
	busyRefusal,
	NS_MODAL_RESPONSE,
	PANEL_KIND,
	PANEL_MAX_PATHS,
	PANEL_STATUS,
	SHEET_CANCEL_TIMEOUT_MS,
	SHEET_POLL_INTERVAL_MS,
} from "./panel-status.ts";
export { createPlatform, DarwinPlatform } from "./platform.ts";
export { PREFLIGHT, preflightError, type PreflightEntry } from "./preflight.ts";
export { awaitSheetResult, type SheetReadings } from "./sheet.ts";
export { darwinWindowAdapter } from "./window-adapter.ts";
