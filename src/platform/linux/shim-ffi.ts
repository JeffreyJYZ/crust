/**
 * Compiling the shipped C shim, once per process. `cc()` compiles C only, and this unit links nothing beyond libc — GTK and WebKit are reached through `dlopen` inside the shim — so there are no `-l` flags and no `-dev` headers are needed.
 * Inside a compiled binary `import.meta.dir` is `/$bunfs/root`, where the .c file does not exist, so the source travels in the binary as text and is materialised to a temp file before `cc()` is called.
 */
import { cc, FFIType } from "bun:ffi";
import { createHash } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { shimSource } from "./shim-source.ts";

const P = FFIType.ptr;
const I32 = FFIType.i32;
const V = FFIType.void;
const CS = FFIType.cstring;

/**
 * The entry points this shim exports, as JS sees them. Declared by hand because the argument types are the contract a fake has to satisfy: every `cstring` argument is a NUL-terminated byte buffer, never a JavaScript string — bun:ffi throws `a JavaScript string is not valid here` on one, measured against real GTK.
 */
export interface LinuxShim {
	shim_lib_open(): number;
	shim_lib_error_text(): string | null;
	shim_gtk_init(): number;
	shim_pump(): number;
	shim_window_new(title: Uint8Array, width: number, height: number, minWidth: number): number;
	shim_window_attach(win: bigint, child: bigint): number;
	shim_window_show(win: bigint): void;
	shim_window_destroy(win: bigint): void;
	shim_window_alive(win: bigint): number;
	shim_webview_new(): number;
	shim_webview_load(web: bigint, url: Uint8Array): number;
}

/** Compile the embedded shim and declare every entry point it exports. */
function compile(): { symbols: LinuxShim } {
	/** Content-hashed, so a second launch reuses the same file and TinyCC's per-path cache. */
	const hash = createHash("sha256").update(shimSource).digest("hex").slice(0, 16);
	const path = join(tmpdir(), `crust-linux-shim-${hash}.c`);
	if (!existsSync(path)) writeFileSync(path, shimSource);

	return cc({
		source: path,
		symbols: {
			shim_lib_open: { args: [], returns: I32 },
			shim_lib_error_text: { args: [], returns: CS },

			shim_gtk_init: { args: [], returns: I32 },
			shim_pump: { args: [], returns: I32 },

			shim_window_new: { args: [CS, I32, I32, I32], returns: P },
			shim_window_attach: { args: [P, P], returns: I32 },
			shim_window_show: { args: [P], returns: V },
			shim_window_destroy: { args: [P], returns: V },
			shim_window_alive: { args: [P], returns: I32 },

			shim_webview_new: { args: [], returns: P },
			shim_webview_load: { args: [P, CS], returns: I32 },
		},
	}) as unknown as { symbols: LinuxShim };
}

let shimOnce: { symbols: LinuxShim } | undefined;

/** Compile the shim at most once per process; `cc()` takes 3–20 ms. */
export function shim(): { symbols: LinuxShim } {
	return (shimOnce ??= compile());
}
