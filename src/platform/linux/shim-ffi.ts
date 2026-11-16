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

/**
 * The proof's own entry points: what a loaded document, its scripts and a failed
 * load answer with. They are declared apart from `LinuxShim` because the platform
 * never calls them — the smoke does — so a fake backend keeps implementing five
 * methods' worth of symbols rather than eleven. Each one is resolved optionally
 * in C, so an older WebKitGTK fails the proof's step by name instead of refusing
 * to launch every app.
 */
export interface LinuxProofShim {
	/** The loaded document's title, read from the view; null before a document commits. */
	shim_webview_title(web: bigint): string | null;
	/** 0 started, 1 redirected, 2 committed, 3 finished, 4 failed. */
	shim_webview_load_state(): number;
	/** The failing URI, then GLib's message, for a failed load; empty otherwise. */
	shim_webview_load_text(): string | null;
	/** Start one script; 0 when the library carries no evaluate_javascript. */
	shim_webview_eval(web: bigint, script: Uint8Array): number;
	/** 0 pending, 1 answered, 2 threw. */
	shim_webview_eval_state(): number;
	/** The answer, or the message a throw carried. */
	shim_webview_eval_text(): string | null;
}

/** Compile the embedded shim and declare every entry point it exports. */
function compile(): { symbols: LinuxShim & LinuxProofShim } {
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

			shim_webview_title: { args: [P], returns: CS },
			shim_webview_load_state: { args: [], returns: I32 },
			shim_webview_load_text: { args: [], returns: CS },
			shim_webview_eval: { args: [P, CS], returns: I32 },
			shim_webview_eval_state: { args: [], returns: I32 },
			shim_webview_eval_text: { args: [], returns: CS },
		},
	}) as unknown as { symbols: LinuxShim & LinuxProofShim };
}

let shimOnce: { symbols: LinuxShim & LinuxProofShim } | undefined;

/** Compile the shim at most once per process; `cc()` takes 3–20 ms. */
export function shim(): { symbols: LinuxShim & LinuxProofShim } {
	return (shimOnce ??= compile());
}
