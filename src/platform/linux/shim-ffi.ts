/**
 * Compiling the shipped C shim, once per process. `cc()` compiles C only, and this unit links nothing beyond libc — GTK and WebKit are reached through `dlopen` inside the shim — so there are no `-l` flags and no `-dev` headers are needed. Linking libc still wants the `libc.so` **linker script**, which only the C development package ships: that one package is the whole reason a machine with GTK and WebKitGTK can still fail here, so a `library c not found` from TinyCC is translated by `linkError` instead of escaping raw.
 * Inside a compiled binary `import.meta.dir` is `/$bunfs/root`, where the .c file does not exist, so the source travels in the binary as text and is materialised to a temp file before `cc()` is called.
 */
import { cc, FFIType } from "bun:ffi";
import { createHash } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { linkError } from "./preflight.ts";
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

	/** 1 when GDK carries every entry point the display list needs; 0 names a GTK too old for it. */
	shim_screen_ready?(): number;
	/** How many displays GDK reports; 0 when it cannot be asked. */
	shim_screen_count(): number;
	/**
	 * Ten doubles for one display, in top-left pixels: frame x/y/w/h, work area x/y/w/h, scale,
	 * then 1 when it is the primary. 1 written, 0 when the index names nothing.
	 */
	shim_screen_info(index: number, out: Float64Array): number;

	/** Resolve libsecret's synchronous API; 1 ready, 0 with a named error in `shim_lib_error_text`. */
	shim_keyring_open(): number;
	/** 1 stored, 0 refused with a named error. */
	shim_keyring_set(service: Uint8Array, account: Uint8Array, secret: Uint8Array): number;
	/**
	 * The secret, or null. `status[0]`: 1 found, 0 not stored, -1 refused, -2 too long.
	 * The returned string is a static C buffer, so no GLib allocation crosses bun:ffi.
	 */
	shim_keyring_get(service: Uint8Array, account: Uint8Array, status: Int32Array): string | null;
	/** 1 removed, 0 nothing stored, -1 refused with a named error. */
	shim_keyring_delete(service: Uint8Array, account: Uint8Array): number;
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

	const options = {
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

			shim_screen_ready: { args: [], returns: I32 },
			shim_screen_count: { args: [], returns: I32 },
			shim_screen_info: { args: [I32, P], returns: I32 },

			shim_keyring_open: { args: [], returns: I32 },
			shim_keyring_set: { args: [CS, CS, CS], returns: I32 },
			shim_keyring_get: { args: [CS, CS, P], returns: CS },
			shim_keyring_delete: { args: [CS, CS], returns: I32 },

			shim_webview_title: { args: [P], returns: CS },
			shim_webview_load_state: { args: [], returns: I32 },
			shim_webview_load_text: { args: [], returns: CS },
			shim_webview_eval: { args: [P, CS], returns: I32 },
			shim_webview_eval_state: { args: [], returns: I32 },
			shim_webview_eval_text: { args: [], returns: CS },
		},
	};

	try {
		return cc(options) as unknown as { symbols: LinuxShim & LinuxProofShim };
	} catch (error) {
		// TinyCC's own message names a library nobody installed and not the package that ships it,
		// so a missing linker script becomes the install line here, where the compile failed.
		const detail = error instanceof Error ? error.message : String(error);
		const translated = linkError(detail);
		if (translated === undefined) throw error;
		throw new Error(`crust: ${translated}`, { cause: error });
	}
}

let shimOnce: { symbols: LinuxShim & LinuxProofShim } | undefined;

/** Compile the shim at most once per process; `cc()` takes 3–20 ms. */
export function shim(): { symbols: LinuxShim & LinuxProofShim } {
	return (shimOnce ??= compile());
}
