/**
 * Compile the `crust:menu` C unit once per process: `shim/98_menu_api.c` with its readback (`98_menu_read.c`) and context (`99_menu_context.c`) parts, concatenated because they share the build stack, the runtime target and their statics. Split from `menu-api.ts` so the symbol list reads on its own, the way `status-bar-ffi.ts` does.
 */

import { cc, FFIType } from "bun:ffi";
import { createHash } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// A compiled binary has no `import.meta.dir`, so the C units travel inside the binary
// as text and are materialised before `cc()` sees them. The parts are one unit.
import apiSource from "./shim/98_menu_api.c" with { type: "text" };
import readSource from "./shim/98_menu_read.c" with { type: "text" };
import contextSource from "./shim/99_menu_context.c" with { type: "text" };

const unitSource = [apiSource, readSource, contextSource].join("");

const P = FFIType.ptr;
const I32 = FFIType.i32;
const I64 = FFIType.i64;
const F64 = FFIType.f64;
const CS = FFIType.cstring;

/** The unit's exports, as `bun:ffi` hands them back. */
export interface MenuUnit {
	symbols: {
		menu_api_target: (imp: number) => number;
		menu_api_begin: () => number;
		menu_api_item: (
			label: number,
			len: number,
			key: number,
			keyLen: number,
			mask: number,
			tag: number,
		) => number;
		menu_api_submenu: (
			label: number,
			len: number,
			key: number,
			keyLen: number,
			mask: number,
		) => number;
		menu_api_separator: () => number;
		menu_api_close: () => number;
		menu_api_install: () => number;
		menu_api_popup: (x: number, y: number) => number;
		menu_api_tag: (sender: number) => number;
		menu_api_read: () => number;
		menu_api_read_parent: (index: number) => number;
		menu_api_read_enabled: (index: number) => number;
		menu_api_read_has_submenu: (index: number) => number;
		menu_api_read_mask: (index: number) => number;
		menu_api_read_title: (index: number) => string;
		menu_api_read_key: (index: number) => string;
		menu_api_is_default: (appName: number, len: number) => number;
	};
}

function compile(): MenuUnit {
	/** Content-hashed, so a second launch reuses the file and TinyCC's cache. */
	const hash = createHash("sha256").update(unitSource).digest("hex").slice(0, 16);
	const file = join(tmpdir(), `crust-menu-${hash}.c`);
	if (!existsSync(file)) writeFileSync(file, unitSource);

	return cc({
		source: file,
		flags: ["-framework", "AppKit", "-framework", "Foundation"],
		symbols: {
			menu_api_target: { args: [P], returns: I32 },
			menu_api_begin: { args: [], returns: I32 },
			menu_api_item: { args: [P, I64, P, I64, I32, I32], returns: I32 },
			menu_api_submenu: { args: [P, I64, P, I64, I32], returns: I32 },
			menu_api_separator: { args: [], returns: I32 },
			menu_api_close: { args: [], returns: I32 },
			menu_api_install: { args: [], returns: I32 },
			menu_api_popup: { args: [F64, F64], returns: I32 },
			menu_api_tag: { args: [P], returns: I32 },
			menu_api_read: { args: [], returns: I32 },
			menu_api_read_parent: { args: [I32], returns: I32 },
			menu_api_read_enabled: { args: [I32], returns: I32 },
			menu_api_read_has_submenu: { args: [I32], returns: I32 },
			menu_api_read_mask: { args: [I32], returns: I64 },
			menu_api_read_title: { args: [I32], returns: CS },
			menu_api_read_key: { args: [I32], returns: CS },
			menu_api_is_default: { args: [P, I64], returns: I32 },
		},
	}) as unknown as MenuUnit;
}

let unitOnce: MenuUnit | undefined;

/** Compile at most once per process; `cc()` costs 3–30 ms. */
export function menuUnit(): MenuUnit {
	return (unitOnce ??= compile());
}
