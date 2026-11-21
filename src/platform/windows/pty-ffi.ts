/**
 * The `bun:ffi` edge for the ConPTY unit: one `cc()` call, its own symbol table, and the table of
 * kernel32 entry points the C resolves at runtime.
 *
 * Kept apart from `ffi.ts` on purpose — see `pty-source.ts`. Declared by hand like every other shim:
 * a `cstring` argument is a NUL-terminated byte buffer, never a JavaScript string, and `bun:ffi`
 * throws on a string before C runs.
 */
import { cc, FFIType } from "bun:ffi";
import { createHash } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ptySource } from "./pty-source.ts";

const I32 = FFIType.i32;
const P = FFIType.ptr;
const CS = FFIType.cstring;

/**
 * The unit's exports, as JavaScript sees them. No HPCON, HANDLE or `STARTUPINFOEXW` crosses this
 * boundary: a call takes an index into the C's own slot table, and every struct is on the C stack.
 */
export interface WindowsPtyShim {
	/** 1 when every kernel32 entry point resolved; 0 with the gap named by `shim_pty_missing`. */
	shim_pty_load(): number;
	shim_pty_ready(): number;
	/** The first entry point that did not resolve, or "" — the machine's own report. */
	shim_pty_missing(): string | null;
	/** Why the last call ended as it did, always one line. */
	shim_pty_reason(): string | null;
	/** `GetLastError()` from the last refused call, or 0. */
	shim_pty_last_error(): number;

	/** A slot index ≥ 0, or -1 with `shim_pty_reason` explaining which call refused. */
	shim_pty_open(shell: Uint8Array, cwd: Uint8Array, cols: number, rows: number): number;
	shim_pty_pid(index: number): number;
	/** Bytes that arrived since the last read, up to `cap`; 0 none, -1 a bad index. */
	shim_pty_read(index: number, dst: Uint8Array, cap: number): number;
	/** Bytes the console accepted, or -1. */
	shim_pty_write(index: number, data: Uint8Array, length: number): number;
	/** 1 resized, 0 refused. */
	shim_pty_resize(index: number, cols: number, rows: number): number;
	/** 0 running, 1 exited, -1 a bad index. */
	shim_pty_state(index: number): number;
	/** The child's own exit code, or -1 while it runs. */
	shim_pty_exit_code(index: number): number;
	shim_pty_kill(index: number): number;
	shim_pty_close(index: number): number;
}

/** One kernel32 entry point the C resolves at runtime, and what stops working without it. */
export interface PtyPreflightEntry {
	module: string;
	symbol: string;
	breaks: string;
}

const k32 = (symbol: string, breaks: string): PtyPreflightEntry => ({
	module: "kernel32.dll",
	symbol,
	breaks,
});

/**
 * Every entry point `63_pty.c` binds with `SHIM_BIND`. `pty-source.test.ts` reads that macro out of
 * the C and fails when a bound symbol is missing here, so this table cannot drift into decoration.
 */
export const PTY_PREFLIGHT: readonly PtyPreflightEntry[] = [
	k32("MultiByteToWideChar", "no path or shell reaches Win32 as text"),
	k32("GetLastError", "a refused call reports no number"),
	k32("CreatePipe", "there is no wire between the page and the console"),
	k32("CloseHandle", "every pipe and process handle leaks"),
	k32("CreatePseudoConsole", "there is no pseudo-console at all — this is the whole feature"),
	k32("ResizePseudoConsole", "pty.resize cannot change the size the program inside sees"),
	k32("ClosePseudoConsole", "pty.close leaves conhost and its pipes alive"),
	k32("CreateProcessW", "no shell is ever started on the console"),
	k32("InitializeProcThreadAttributeList", "the console attribute has nowhere to live"),
	k32("UpdateProcThreadAttribute", "the child is started without a console"),
	k32("DeleteProcThreadAttributeList", "every spawn leaks its attribute list"),
	k32("GetProcessHeap", "the attribute list has no allocator"),
	k32("HeapAlloc", "the attribute list cannot be allocated"),
	k32("HeapFree", "the attribute list cannot be released"),
	k32("WaitForSingleObject", "exit and close never observe the child"),
	k32("GetExitCodeProcess", "pty-exit reports no status"),
	k32("TerminateProcess", "pty.close cannot end a shell that ignores the hangup"),
	k32("CreateThread", "the console's output is never drained"),
	k32("ReadFile", "bytes the program wrote never reach the page"),
	k32("WriteFile", "pty.write cannot type into the console"),
	k32("InitializeCriticalSection", "the ring has no lock, so a read races the reader"),
	k32("EnterCriticalSection", "the same race, on the way in"),
	k32("LeaveCriticalSection", "the same race, on the way out"),
	k32("DeleteCriticalSection", "a closed console's lock is never released"),
];

/**
 * Materialise the unit and compile it. Content-hashed, so a second launch reuses the same file and
 * TinyCC's per-path cache. `cc()` links nothing: every kernel32 entry point is resolved by the C.
 */
export function compilePty(): WindowsPtyShim {
	const hash = createHash("sha256").update(ptySource).digest("hex").slice(0, 16);
	const path = join(tmpdir(), `crust-pty-${hash}.c`);
	if (!existsSync(path)) writeFileSync(path, ptySource);
	const library = cc({
		source: path,
		symbols: {
			shim_pty_load: { args: [], returns: I32 },
			shim_pty_ready: { args: [], returns: I32 },
			shim_pty_missing: { args: [], returns: CS },
			shim_pty_reason: { args: [], returns: CS },
			shim_pty_last_error: { args: [], returns: I32 },
			shim_pty_open: { args: [CS, CS, I32, I32], returns: I32 },
			shim_pty_pid: { args: [I32], returns: I32 },
			shim_pty_read: { args: [I32, P, I32], returns: I32 },
			shim_pty_write: { args: [I32, P, I32], returns: I32 },
			shim_pty_resize: { args: [I32, I32, I32], returns: I32 },
			shim_pty_state: { args: [I32], returns: I32 },
			shim_pty_exit_code: { args: [I32], returns: I32 },
			shim_pty_kill: { args: [I32], returns: I32 },
			shim_pty_close: { args: [I32], returns: I32 },
		},
	}) as unknown as { symbols: WindowsPtyShim };
	return library.symbols;
}

let once: WindowsPtyShim | undefined;

/** Compile at most once per process; `cc()` takes 3–20 ms and the unit lives as long as the app. */
export function conptyShim(): WindowsPtyShim {
	return (once ??= compilePty());
}
