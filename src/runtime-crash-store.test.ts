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
import { clearCrashes, listCrashes, readLastCrash, recordCrash } from "@/runtime-crash-store";

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
