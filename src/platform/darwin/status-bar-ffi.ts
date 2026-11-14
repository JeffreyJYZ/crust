/**
 * Compile the status-bar C unit, once per process. It ships as several parts so none outgrows the line cap, but it is **one translation unit**: the parts share statics (`tray_target`, `tray_title_buf`, `tray_building_menu`) and a static is private to its unit, so compiling them separately would give each its own copy and the click trampoline would route to a different target than the menu rows point at. They are concatenated here in the original `status_bar.c` order and handed to `cc()` as text.
 */

import { cc, FFIType } from "bun:ffi";
import { createHash } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { StatusBarShim } from "./status-bar-symbols";

// Inside a compiled binary `import.meta.dir` is `/$bunfs/root`, where the .c
// file does not exist, so the source travels inside the binary as text and is
// materialised to a temp file before `cc()` is called. Same route as shim.c.
import prelude from "./status_bar/00_prelude.c" with { type: "text" };
import guards from "./status_bar/10_guards.c" with { type: "text" };
import target from "./status_bar/20_target.c" with { type: "text" };
import item from "./status_bar/30_item.c" with { type: "text" };
import readback from "./status_bar/40_readback.c" with { type: "text" };
import menu from "./status_bar/50_menu.c" with { type: "text" };
import teardown from "./status_bar/60_teardown.c" with { type: "text" };

/** The whole unit as C source, in declaration order, byte-exact as one file. */
export const statusBarSource = [prelude, guards, target, item, readback, menu, teardown].join("");

/** Pointer and void types, also used by the JS click trampoline's own signature. */
export const PTR = FFIType.ptr;
export const VOID = FFIType.void;

const P = PTR;
const I32 = FFIType.i32;
const I64 = FFIType.i64;
const F64 = FFIType.f64;
const V = VOID;
const CS = FFIType.cstring;

function materialisedSource(): string {
	const hash = createHash("sha256").update(statusBarSource).digest("hex").slice(0, 16);
	const path = join(tmpdir(), `crust-status-bar-${hash}.c`);
	if (!existsSync(path)) writeFileSync(path, statusBarSource);
	return path;
}

function compile(): StatusBarShim {
	return cc({
		source: materialisedSource(),
		flags: ["-framework", "AppKit", "-framework", "Foundation"],
		symbols: {
			tray_abi: { args: [], returns: I32 },
			tray_create: { args: [P], returns: P },
			tray_set_title: { args: [P, P, I64], returns: I32 },
			tray_title_copy: { args: [P], returns: CS },
			tray_title_capacity: { args: [], returns: I32 },
			tray_set_visible: { args: [P, I32], returns: I32 },
			tray_item_visible: { args: [P], returns: I32 },
			tray_item_length: { args: [P], returns: F64 },
			tray_button_window: { args: [P], returns: I64 },
			tray_button_window_visible: { args: [P], returns: I32 },
			tray_button_window_frame: { args: [P, P], returns: I32 },
			tray_button_window_occlusion: { args: [P], returns: I64 },
			tray_button_window_active_space: { args: [P], returns: I32 },
			tray_menu_begin: { args: [P], returns: I32 },
			tray_menu_add: { args: [P, I64, I32], returns: I32 },
			tray_menu_end: { args: [P], returns: I32 },
			tray_menu_clear: { args: [P], returns: I32 },
			tray_menu_count: { args: [P], returns: I32 },
			tray_menu_activate: { args: [P, I32], returns: I32 },
			tray_item_index: { args: [P], returns: I32 },
			tray_destroy: { args: [P], returns: V },
		},
	}) as unknown as StatusBarShim;
}

let shimOnce: StatusBarShim | undefined;

/** Compile the status-bar unit at most once per process. */
export function statusBar(): StatusBarShim {
	return (shimOnce ??= compile());
}
