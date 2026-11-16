/**
 * The `bun:ffi` edge: compile the shipped C shim and hand back its symbol table. Kept apart from
 * `backend.ts` so the probe (files and registry, no compilation) never pays for a compile, and so
 * the declaration table below can be read against the C units it calls.
 */
import { cc, FFIType } from "bun:ffi";
import { createHash } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { WindowsShim } from "./backend.ts";
import { shimSource } from "./shim-source.ts";

const P = FFIType.ptr;
const I32 = FFIType.i32;
const I64 = FFIType.i64;
const F64 = FFIType.f64;
const V = FFIType.void;
const CS = FFIType.cstring;

/**
 * Materialise the embedded shim and return its path. Inside a compiled binary `import.meta.dir` is
 * `/$bunfs/root`, where the `.c` file does not exist, so the source travels as text. Content-hashed,
 * so a second launch reuses the same file and TinyCC's per-path cache.
 */
function shimPath(): string {
	const hash = createHash("sha256").update(shimSource).digest("hex").slice(0, 16);
	const path = join(tmpdir(), `crust-windows-shim-${hash}.c`);
	if (!existsSync(path)) writeFileSync(path, shimSource);
	return path;
}

/**
 * Compile the shim. `WebView2Loader.dll` must sit beside the binary or on `PATH`: it is the one
 * import library a Windows machine cannot be assumed to have, and the preflight names it when it
 * is absent.
 */
export function compile(): WindowsShim {
	return cc({
		source: shimPath(),
		flags: ["-luser32", "-lkernel32", "-lole32", "-lWebView2Loader"],
		symbols: {
			shim_com_init: { args: [], returns: I64 },
			shim_last_error: { args: [], returns: I64 },
			shim_register_class: { args: [CS], returns: I64 },
			shim_pump: { args: [], returns: I32 },
			shim_post_quit: { args: [], returns: V },

			shim_window_new: { args: [CS, I32, I32, CS], returns: P },
			shim_window_is_open: { args: [P], returns: I32 },
			shim_window_set_title: { args: [P, CS], returns: I32 },
			shim_window_destroy: { args: [P], returns: I32 },
			shim_window_client_num: { args: [P, I32], returns: I32 },

			shim_webview_new: { args: [P, CS, CS], returns: I32 },
			shim_webview_put_bounds: { args: [P, F64, F64], returns: I32 },
			shim_webview_close: { args: [P], returns: V },
		},
	}) as unknown as WindowsShim;
}
