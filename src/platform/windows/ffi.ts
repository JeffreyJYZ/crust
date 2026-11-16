/**
 * The `bun:ffi` edge: compile the shipped C shim and hand back its symbol table. Kept apart from
 * `backend.ts` so the probe (files and registry, no compilation) never pays for a compile, and so
 * the declaration table below can be read against the C units it calls.
 *
 * `cc()` links nothing. Every Win32 and WebView2 entry point is a pointer `12_win32.c` resolves at
 * runtime, because TinyCC's PE import thunk for a DLL jumped to `0xFFFFFFFFFFFFFFFF` on the first
 * call on Windows x64 (2026-11-16). The only imports left — `LoadLibraryA` and `GetProcAddress` —
 * are kernel32, which TinyCC's PE runtime links for its own CRT whatever `cc()` asks for, so there
 * is no `library` entry and no `-L` path.
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

/** The TinyCC options `cc()` composes with `flags`; repeated here so a failure can print them. */
export const SHIM_CC_OPTIONS = "-std=c11 -Wl,--export-all-symbols -g -O2";

/**
 * The command `cc()` describes, for a failure that has to name what TinyCC was handed. `cc()` never
 * shows its own invocation, so this is the equivalent tcc command line, not the argv Bun built
 * internally. There is no `-l` and no `-L` to print, because nothing is linked.
 */
export function tccCommand(source: string): string {
	return ["tcc", SHIM_CC_OPTIONS, source].join(" ");
}

/**
 * Materialise the embedded shim and return its path. Inside a compiled binary `import.meta.dir` is
 * `/$bunfs/root`, where the `.c` file does not exist, so the source travels as text. Content-hashed,
 * so a second launch reuses the same file and TinyCC's per-path cache.
 */
export function shimPath(): string {
	const hash = createHash("sha256").update(shimSource).digest("hex").slice(0, 16);
	const path = join(tmpdir(), `crust-windows-shim-${hash}.c`);
	if (!existsSync(path)) writeFileSync(path, shimSource);
	return path;
}

/**
 * What `cc()` hands back: the symbol table one level down under `symbols`, plus a `close` this
 * process never calls because the shim lives as long as the app. Named so the cast below says what
 * it is casting to — casting the result straight to `WindowsShim` compiles and then makes every
 * call `undefined` (measured on the real runner: `shim.shim_com_init is not a function`).
 */
interface ShimLibrary {
	symbols: WindowsShim;
}

/** The symbol table out of a `cc()` result. Split out so the unwrap is testable on any OS. */
export function shimSymbols(library: { symbols: WindowsShim }): WindowsShim {
	return library.symbols;
}

/** A thrown value as one line, the way tcc reports it. */
function reason(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/**
 * Compile the shim, which links nothing — see the header. A failure here is a defect in crust, not
 * a missing runtime, so it carries the tcc command line; that is attached here rather than in a
 * caller so every caller gets it, and a throw that is not a build failure stays undecorated.
 */
export function compile(): WindowsShim {
	const source = shimPath();
	try {
		const library = cc({
			source,
			symbols: {
				shim_win32_ready: { args: [], returns: I32 },
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

				// The WebView2 path, one step at a time, so a probe can print between them.
				shim_env_begin: { args: [CS], returns: I64 },
				shim_env_wait: { args: [], returns: I32 },
				shim_env_callback: { args: [], returns: I64 },
				shim_controller_begin: { args: [P], returns: I64 },
				shim_controller_wait: { args: [], returns: I32 },
				shim_controller_callback: { args: [], returns: I64 },
				shim_webview_attach: { args: [P], returns: I32 },
				shim_webview_navigate: { args: [CS], returns: I32 },

				// The handler object's ABI, as the numbers Windows would read.
				shim_handler_prepare: { args: [], returns: I32 },
				shim_handler_vtbl_addr: { args: [], returns: P },
				shim_handler_object_addr: { args: [], returns: P },
				shim_handler_first_field: { args: [], returns: P },
				shim_handler_entry: { args: [I32], returns: P },
			},
		}) as unknown as ShimLibrary;
		return shimSymbols(library);
	} catch (error) {
		throw new Error([reason(error), tccCommand(source)].join("\n"), { cause: error });
	}
}
