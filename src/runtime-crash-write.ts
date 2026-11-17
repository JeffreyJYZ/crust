/**
 * The writing half of the crash store: both files a record lands in, their mode, and the rotation
 * that keeps the log from growing forever. Split from `runtime-crash-store.ts` so each half is
 * readable in one sitting; the readers import these types, so this file owns the shape.
 *
 * Two halves write here and they must not drift: the guard, which names a fault it watched die, and
 * the page, which names an error it caught itself. Same layout, same `0600`, same rotation — only
 * `type` and the guard-only fields differ.
 */

import { appendFileSync, chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import {
	CRASH_EXIT_CODE,
	type CrashRecord,
	crashLogPath,
	decodeCrashRecord,
	type DecodedCrash,
	isCrashRecord,
	lastCrashPath,
	signalName,
} from "./platform/darwin/crash-record";

/**
 * Which half wrote a record. The guard names a fault it watched die (`"signal"`); a page names an
 * error it caught itself (`"webview"`), which is the ordinary case — an `onerror` in a render loop
 * never faults the process, so nothing but the page can report it.
 */
export type CrashRecordType = "signal" | "webview";

/** A stored record: the guard's layout, plus which half wrote it and what a page said. */
export interface StoredCrash extends CrashRecord {
	type: CrashRecordType;
	message?: string;
	stack?: string;
}

/** How many records the log keeps; older lines are dropped, because a log that only grows is a leak. */
export const MAX_CRASH_RECORDS = 200;
/** A page's message and stack are truncated to this, never refused. */
export const MAX_CRASH_CHARS = 8192;

/**
 * A page's text, cut to the cap rather than rejected. Losing a crash because its stack was long is
 * the worst behaviour available, so an over-long field keeps its head and says it was cut — and the
 * whole value, suffix included, still fits the cap, so a report cannot grow the record it lands in.
 */
export function truncateField(text: string, cap: number = MAX_CRASH_CHARS): string {
	if (text.length <= cap) return text;
	const suffix = `… [truncated ${text.length} chars]`;
	return `${text.slice(0, Math.max(0, cap - suffix.length))}${suffix}`;
}

/**
 * A crash artefact carries the signal, the fault address, the handler and the app's paths, so it is
 * private to the user who owns it. The `mode` argument applies only when a file is created, and a
 * log an older build already left world-readable still exists, so the `chmod` is not redundant.
 */
export function privateTo(path: string): void {
	try {
		chmodSync(path, 0o600);
	} catch {
		// A filesystem without POSIX modes is no reason to lose the crash.
	}
}

/** Keep only the newest `MAX_CRASH_RECORDS` lines; a log past the cap is rewritten, not refused. */
export function rotateLog(log: string): void {
	let lines: string[];
	try {
		lines = readFileSync(log, "utf8")
			.split("\n")
			.filter((line) => line.length > 0);
	} catch {
		return;
	}
	if (lines.length <= MAX_CRASH_RECORDS) return;
	writeFileSync(log, `${lines.slice(-MAX_CRASH_RECORDS).join("\n")}\n`, {
		encoding: "utf8",
		mode: 0o600,
	});
	privateTo(log);
}

/**
 * Append one record, rewrite `last-crash.json`, and drop the oldest lines past the cap. Both files
 * are written here so a page report and a guard report cannot drift apart in layout or mode.
 */
export function writeRecord(root: string, crash: StoredCrash): StoredCrash {
	mkdirSync(root, { recursive: true });
	const log = crashLogPath(root);
	const last = lastCrashPath(root);
	appendFileSync(log, `${JSON.stringify(crash)}\n`, { encoding: "utf8", mode: 0o600 });
	writeFileSync(last, `${JSON.stringify(crash, null, "\t")}\n`, {
		encoding: "utf8",
		mode: 0o600,
	});
	privateTo(log);
	privateTo(last);
	rotateLog(log);
	return crash;
}

/**
 * Turn a decoded record into the shape a caller reads and write both files. `at` is the guard's
 * clock, not the fault's: the handler may not format a timestamp, so this is the observation time.
 */
export function recordCrash(
	root: string,
	decoded: DecodedCrash,
	at: Date = new Date(),
): StoredCrash {
	const name = signalName(decoded.signal);
	return writeRecord(root, {
		type: "signal",
		signal: name,
		code: decoded.code,
		address: `0x${decoded.address.toString(16)}`,
		at: at.toISOString(),
		handler: decoded.handler.length > 0 ? decoded.handler : (name ?? "unknown"),
		exitCode: CRASH_EXIT_CODE,
	});
}

/**
 * One record a **page** caught — the `onerror` in a render loop that never faults the process, so
 * the guard can never see it. Same store, same layout and mode as a guard record, so `last` and
 * `list` answer it identically and `type: "webview"` is what tells the two halves apart.
 *
 * Both text fields are truncated to the cap, never refused.
 */
export function recordPageCrash(
	root: string,
	report: { message?: unknown; stack?: unknown },
	at: Date = new Date(),
): StoredCrash {
	const message = truncateField(typeof report?.message === "string" ? report.message : "");
	const crash: StoredCrash = {
		type: "webview",
		signal: null,
		code: null,
		address: null,
		at: at.toISOString(),
		handler: "webview",
		exitCode: null,
		message,
	};
	if (typeof report?.stack === "string") crash.stack = truncateField(report.stack);
	return writeRecord(root, crash);
}

/**
 * A record read back from disk. A record written before `type` existed came from the guard, because
 * the page half did not write records then, so it is named `"signal"` rather than left blank.
 */
export function asStored(value: unknown): StoredCrash | null {
	if (!isCrashRecord(value)) return null;
	const record = value as StoredCrash;
	if (record.type !== "signal" && record.type !== "webview") return { ...record, type: "signal" };
	return record;
}

/** The decoded fixed record, re-exported so a caller of this file needs no second import. */
export { decodeCrashRecord };
