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
 * The libraries the shim links, named the way TinyCC resolves them: `<name>.dll` in its library
 * path, which on PE already includes the Windows system directory.
 *
 * They must NOT be passed as `-l<name>` inside `flags`. TinyCC's option parser hands `-l` to
 * `args_parser_add_file`, which only appends the name to `state->files`; that queue is walked by
 * the tcc CLI and never by an embedded libtcc, so the flag is parsed and dropped with no error, and
 * every call it should have satisfied fails later as `unresolved reference to '…'`. Measured on bun
 * 1.4.4: `flags: ["-lbogusxyz"]` compiles clean, `library: ["bogusxyz"]` fails loudly with
 * `tcc: error: library 'bogusxyz' not found`.
 *
 * `gdi32` is absent because nothing here calls a gdi32 export — `GetClientRect` is user32 and no
 * device context is created. `kernel32` is listed although TinyCC's PE runtime adds it on its own,
 * so this list states what the shim needs rather than what the compiler happens to supply.
 */
export const SHIM_LIBRARIES = ["user32", "ole32", "kernel32"] as const;

/**
 * The TinyCC options `cc()` composes with `flags`, copied from `CompileC::DEFAULT_TCC_OPTIONS` in
 * Bun's `ffi_body.rs`. They are repeated only so a failure can print the command it describes: if
 * upstream changes that string, the printed line goes stale, and nothing about the link does.
 */
export const SHIM_CC_OPTIONS = "-std=c11 -Wl,--export-all-symbols -g -O2";

/**
 * The Windows system directory, where every library above sits as a DLL TinyCC reads directly.
 * TinyCC's `tcc_add_systemdir` already puts it on the library path; passing it as `-L` as well keeps
 * that true if that option is ever compiled out, and lets a failure print the directory searched.
 */
export function systemDirectory(env: Record<string, string | undefined> = process.env): string {
	const root = env["SystemRoot"] ?? env["windir"] ?? "C:\\Windows";
	return join(root, "System32");
}

/**
 * The extra TinyCC options. `-L` is applied by the option parser immediately (`tcc_add_library_path`),
 * unlike `-l`, so it works. A path containing a space is skipped: the option string is
 * whitespace-split, and the system directory is already on TinyCC's own library path, so nothing is
 * lost by leaving it out.
 */
export function shimFlags(systemDir: string = systemDirectory()): string[] {
	return /\s/.test(systemDir) ? [] : [`-L${systemDir}`];
}

/** What `cc()` is handed: the extra options and the libraries, kept together so both can be pinned. */
export interface ShimLink {
	flags: string[];
	library: string[];
}

/** The link inputs for one compile. Pure, so a test can pin them on a machine without user32. */
export function shimLink(systemDir: string = systemDirectory()): ShimLink {
	return { flags: shimFlags(systemDir), library: [...SHIM_LIBRARIES] };
}

/**
 * The command these inputs describe, for a failure that has to name what the linker was given.
 * `cc()` never shows its own invocation, so this is the equivalent tcc command line — the libraries
 * reach `tcc_add_library`, which is exactly what `-l` means — not the argv Bun built internally.
 */
export function tccCommand(source: string, systemDir: string = systemDirectory()): string {
	const { flags, library } = shimLink(systemDir);
	const parts = ["tcc", SHIM_CC_OPTIONS, ...flags, source, ...library.map((name) => `-l${name}`)];
	return parts.join(" ");
}

/** TinyCC's own search order for a library name on PE, so a report names the file it would open. */
function libraryCandidates(name: string): string[] {
	return [`${name}.def`, `lib${name}.def`, `${name}.dll`, `lib${name}.dll`, `lib${name}.a`];
}

/**
 * One line per link input: the file TinyCC would open, or the names it looked for and did not find.
 * A missing library is the cause of a wall of unresolved references, so it is named first.
 */
export function linkReport(systemDir: string = systemDirectory()): string[] {
	return SHIM_LIBRARIES.map((name) => {
		for (const candidate of libraryCandidates(name)) {
			const path = join(systemDir, candidate);
			if (existsSync(path)) return `library ${name} -> ${path}`;
		}
		return `library ${name} -> not found (${libraryCandidates(name).join(", ")}) in ${systemDir}`;
	});
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
 * Compile the shim. The libraries go through `library`, never through `-l` flags — see
 * `SHIM_LIBRARIES`. `WebView2Loader.dll` is deliberately not among them: the shim resolves its one
 * export at runtime, so a machine without the loader still compiles the shim and gets the preflight
 * message instead of a linker failure.
 */
export function compile(): WindowsShim {
	const link = shimLink();
	return cc({
		source: shimPath(),
		flags: link.flags,
		library: link.library,
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
