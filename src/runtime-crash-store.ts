/**
 * Where a recorded crash is read back from. The writing half — both files, their `0600` mode and the
 * log rotation — lives in `runtime-crash-write.ts`, and everything below is re-exported here so a
 * caller has one import: the guard writes, the plugin reads.
 * A line in `crashes.log` is one JSON object; `last-crash.json` is the same object rewritten, because
 * a page wants the newest crash without scanning a log that grows.
 */

import { readFileSync, rmSync } from "node:fs";
import {
	crashLogPath,
	crashRecordPath,
	decodeCrashRecord,
	type DecodedCrash,
	lastCrashPath,
} from "./platform/darwin/crash-record";
import { asStored, type StoredCrash } from "./runtime-crash-write";

export {
	asStored,
	MAX_CRASH_CHARS,
	MAX_CRASH_RECORDS,
	recordCrash,
	recordPageCrash,
	type CrashRecordType,
	type StoredCrash,
	truncateField,
	writeRecord,
} from "./runtime-crash-write";

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

/** The last crash this app recorded, or null when none was. */
export function readLastCrash(root: string): StoredCrash | null {
	try {
		return asStored(JSON.parse(readFileSync(lastCrashPath(root), "utf8")));
	} catch {
		return null;
	}
}

/** Every recorded crash, oldest first; `limit` keeps the most recent ones. */
export function listCrashes(root: string, limit?: number): StoredCrash[] {
	let text = "";
	try {
		text = readFileSync(crashLogPath(root), "utf8");
	} catch {
		return [];
	}
	const records: StoredCrash[] = [];
	for (const line of text.split("\n")) {
		if (line.length === 0) continue;
		try {
			const record = asStored(JSON.parse(line));
			if (record !== null) records.push(record);
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
