/**
 * `runtime-crash-store` against a temp root. What is proven: both artefacts land 0600 like the
 * record beside them, a log an older build left world-readable is tightened rather than appended to
 * as-is, and the runtime's own clear is idempotent and leaves the pending record alone.
 * Nothing here faults a process: a decoded record is handed to `recordCrash` directly.
 */

import { describe, expect, test } from "bun:test";
import { chmod, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { crashLogPath, lastCrashPath, type DecodedCrash } from "@/platform/darwin/crash-record";
import {
	clearCrashes,
	listCrashes,
	MAX_CRASH_CHARS,
	MAX_CRASH_RECORDS,
	readLastCrash,
	recordCrash,
	recordPageCrash,
} from "@/runtime-crash-store";

/** SIGSEGV, `SEGV_MAPERR`, address 0: the shape the guard decodes from the record. */
const DECODED: DecodedCrash = { signal: 11, code: 1, address: 0n, handler: "SIGSEGV" };

async function scratch(): Promise<string> {
	return await mkdtemp(join(tmpdir(), "crust-crash-store-"));
}

async function modeOf(path: string): Promise<number> {
	return (await stat(path)).mode & 0o777;
}

describe("crash artefacts are private", () => {
	test("the log and last-crash both land 0600", async () => {
		const root = await scratch();
		try {
			recordCrash(root, DECODED, new Date("2026-11-16T00:00:00.000Z"));
			expect(await modeOf(crashLogPath(root))).toBe(0o600);
			expect(await modeOf(lastCrashPath(root))).toBe(0o600);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	test("a log an older build left 0644 is tightened, not appended to as-is", async () => {
		const root = await scratch();
		try {
			await writeFile(crashLogPath(root), "", "utf8");
			await chmod(crashLogPath(root), 0o644);
			recordCrash(root, DECODED);
			expect(await modeOf(crashLogPath(root))).toBe(0o600);
			expect(listCrashes(root)).toHaveLength(1);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});

describe("a page's own record", () => {
	test("lands beside the guard's, marked webview, and rotates past the cap", async () => {
		const root = await scratch();
		try {
			recordCrash(root, DECODED, new Date("2026-11-16T00:00:00.000Z"));
			recordPageCrash(root, { message: "onerror", stack: "at App" });
			const [guardRecord, pageRecord] = listCrashes(root);
			expect(guardRecord?.type).toBe("signal");
			expect(pageRecord).toMatchObject({
				type: "webview",
				message: "onerror",
				stack: "at App",
			});
			expect(readLastCrash(root)?.type).toBe("webview");
			expect(await modeOf(crashLogPath(root))).toBe(0o600);
			expect(await modeOf(lastCrashPath(root))).toBe(0o600);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	test("a long stack is truncated at the cap, not dropped", async () => {
		const root = await scratch();
		try {
			const long = "x".repeat(MAX_CRASH_CHARS + 10);
			const written = recordPageCrash(root, { message: long });
			// The whole value fits the cap, suffix included, so a report cannot grow its own record.
			expect(written.message?.length).toBeLessThanOrEqual(MAX_CRASH_CHARS);
			expect(written.message).toContain(`[truncated ${long.length} chars]`);
			expect(listCrashes(root)).toHaveLength(1);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	test("the log keeps only the newest records past the cap", async () => {
		const root = await scratch();
		try {
			for (let index = 0; index < MAX_CRASH_RECORDS + 3; index++) {
				recordPageCrash(root, { message: `crash ${index}` });
			}
			const records = listCrashes(root);
			expect(records).toHaveLength(MAX_CRASH_RECORDS);
			expect(records[0]?.message).toBe("crash 3");
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});

describe("the runtime's clear", () => {
	test("forgets both files, is idempotent, and leaves the record alone", async () => {
		const root = await scratch();
		try {
			recordCrash(root, DECODED);
			expect(readLastCrash(root)).toMatchObject({ signal: "SIGSEGV", address: "0x0" });
			expect(clearCrashes(root)).toEqual([lastCrashPath(root), crashLogPath(root)]);
			expect(clearCrashes(root)).toEqual([]);
			expect(readLastCrash(root)).toBe(null);
			expect(listCrashes(root)).toEqual([]);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});
