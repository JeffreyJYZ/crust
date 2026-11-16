/**
 * The crash record's byte layout, in one place. The C handler writes it (`shim/111_crash.c`), the guard reads it, the plugin reports it, so the constants live here rather than being restated by each side.
 * The record is fixed-size on purpose: the writer runs inside a process that has already faulted, so it may not format, allocate or measure anything. That constraint is why this reader exists at all.
 */

import { join } from "node:path";

/** The record file, directly under the app's data directory. */
export const CRASH_RECORD_FILE = "crash-record.bin";
/** One JSON object per line, appended by the guard. */
export const CRASH_LOG_FILE = "crashes.log";
/** The most recent crash, rewritten on every record. */
export const LAST_CRASH_FILE = "last-crash.json";

/** `CRSH`, i32 signal, i32 `si_code`, u64 address, then a 64-byte NUL-padded handler name. */
export const CRASH_RECORD_BYTES = 84;
export const CRASH_HANDLER_BYTES = 64;
export const CRASH_RECORD_MAGIC = "CRSH";

/**
 * `_exit` in `shim/111_crash.c`. The record exists only because the handler wrote it immediately
 * before leaving, so 70 is the exit status of any crash it recorded — a fact of the writer, not a
 * guess by the reader.
 */
export const CRASH_EXIT_CODE = 70;

/** One crash, as `last-crash.json` and a `crashes.log` line carry it. */
export interface CrashRecord {
	/** Signal name, e.g. `SIGSEGV`; null when the record named a signal this build does not map. */
	signal: string | null;
	/** `si_code`: `SEGV_MAPERR` 1 and `SEGV_ACCERR` 2 are the two a real fault produces. */
	code: number | null;
	/** The faulting address as hex, `0x0` when the kernel supplied none. */
	address: string | null;
	/** When the guard observed the crash; the handler may not format a clock. */
	at: string;
	/** The handler's own name, taken from the C record. */
	handler: string;
	/** 70 for a recorded fault, null when no record was readable. */
	exitCode: number | null;
}

/** The record as it comes off disk, before the guard names it. */
export interface DecodedCrash {
	signal: number;
	code: number;
	address: bigint;
	handler: string;
}

export function crashRecordPath(root: string): string {
	return join(root, CRASH_RECORD_FILE);
}

export function crashLogPath(root: string): string {
	return join(root, CRASH_LOG_FILE);
}

export function lastCrashPath(root: string): string {
	return join(root, LAST_CRASH_FILE);
}

/** The five signals `shim/111_crash.c` installs handlers for, and no others. */
const SIGNAL_NAMES: Record<number, string> = {
	4: "SIGILL",
	6: "SIGABRT",
	8: "SIGFPE",
	10: "SIGBUS",
	11: "SIGSEGV",
};

export function signalName(number: number): string | null {
	return SIGNAL_NAMES[number] ?? null;
}

/**
 * Read the fixed record. Null for an absent, short or foreign file — arming truncates it, so a
 * clean exit leaves nothing behind and "no record" reads as "no fault".
 */
export function decodeCrashRecord(bytes: Uint8Array): DecodedCrash | null {
	if (bytes.length < CRASH_RECORD_BYTES) return null;
	const magic = String.fromCharCode(bytes[0] ?? 0, bytes[1] ?? 0, bytes[2] ?? 0, bytes[3] ?? 0);
	if (magic !== CRASH_RECORD_MAGIC) return null;
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const limit = 20 + CRASH_HANDLER_BYTES;
	let end = 20;
	while (end < limit && (bytes[end] ?? 0) !== 0) end++;
	return {
		signal: view.getInt32(4, true),
		code: view.getInt32(8, true),
		address: view.getBigUint64(12, true),
		handler: new TextDecoder().decode(bytes.subarray(20, end)),
	};
}

/** A parsed line is only a crash when it carries the two fields every record must have. */
export function isCrashRecord(value: unknown): value is CrashRecord {
	if (typeof value !== "object" || value === null) return false;
	const record = value as CrashRecord;
	return typeof record.at === "string" && typeof record.handler === "string";
}
