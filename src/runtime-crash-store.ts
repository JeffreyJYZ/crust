/**
 * Where a recorded crash lands, and how it is read back. The guard is the only writer and the plugin is the only reader, so the two files are named and parsed here rather than in either caller.
 * A line in `crashes.log` is one JSON object; `last-crash.json` is the same object rewritten, because a page wants the newest crash without scanning a log that grows.
 */

import { appendFileSync, chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import {
	CRASH_EXIT_CODE,
	type CrashRecord,
	crashLogPath,
	crashRecordPath,
	decodeCrashRecord,
	type DecodedCrash,
	isCrashRecord,
	lastCrashPath,
	signalName,
} from "./platform/darwin/crash-record";

/** The record on disk, or null when it is absent, empty or not a record. */
export function readCrashRecord(root: string): DecodedCrash | null {
	let bytes: Uint8Array;
	try {
		bytes = new Uint8Array(readFileSync(crashRecordPath(root)));
	} catch {
		return null;
	}
	return decodeCrashRecord(bytes);
}

/**
 * A crash artefact carries the signal, the fault address, the handler and the app's paths, so it is
 * private to the user who owns it. The `mode` argument applies only when a file is created, and a
 * log an older build already left world-readable still exists, so the `chmod` is not redundant.
 */
function privateTo(path: string): void {
	try {
		chmodSync(path, 0o600);
	} catch {
		// A filesystem without POSIX modes is no reason to lose the crash.
	}
}

/**
 * Turn a decoded record into the shape a caller reads and write both files. `at` is the guard's
 * clock, not the fault's: the handler may not format a timestamp, so this is the observation time.
 */
export function recordCrash(
	root: string,
	decoded: DecodedCrash,
	at: Date = new Date(),
): CrashRecord {
	const name = signalName(decoded.signal);
	const crash: CrashRecord = {
		signal: name,
		code: decoded.code,
		address: `0x${decoded.address.toString(16)}`,
		at: at.toISOString(),
		handler: decoded.handler.length > 0 ? decoded.handler : (name ?? "unknown"),
		exitCode: CRASH_EXIT_CODE,
	};
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
	return crash;
}

/** The last crash this app recorded, or null when none was. */
export function readLastCrash(root: string): CrashRecord | null {
	try {
		const parsed: unknown = JSON.parse(readFileSync(lastCrashPath(root), "utf8"));
		return isCrashRecord(parsed) ? parsed : null;
	} catch {
		return null;
	}
}

/** Every recorded crash, oldest first; `limit` keeps the most recent ones. */
export function listCrashes(root: string, limit?: number): CrashRecord[] {
	let text = "";
	try {
		text = readFileSync(crashLogPath(root), "utf8");
	} catch {
		return [];
	}
	const records: CrashRecord[] = [];
	for (const line of text.split("\n")) {
		if (line.length === 0) continue;
		try {
			const parsed: unknown = JSON.parse(line);
			if (isCrashRecord(parsed)) records.push(parsed);
		} catch {
			// A torn line is not a crash; the next one still is.
		}
	}
	const asked =
		limit !== undefined && Number.isInteger(limit) && limit > 0 ? limit : records.length;
	return records.slice(Math.max(0, records.length - asked));
}

/**
 * Forget every recorded crash: the log and the last-crash file. The record itself stays, because
 * the guard may still be about to read it and deleting it would hide an unrecorded fault.
 * **The runtime calls this, never a page**: `crash-reporter.clear` refuses a page, because the page
 * is the process whose bug produced the crash and the last caller that may delete the record of it.
 */
export function clearCrashes(root: string): string[] {
	const removed: string[] = [];
	for (const path of [lastCrashPath(root), crashLogPath(root)]) {
		try {
			rmSync(path);
			removed.push(path);
		} catch {
			// Absent already: clearing is idempotent, and the caller sees what was there.
		}
	}
	return removed;
}
