/**
 * The fixed record layout is the guard's side of the crash contract, so its decode proof lives apart
 * from the child-process proofs: it needs no spawned process and no temp directory.
 */

import { describe, expect, test } from "bun:test";
import { CRASH_RECORD_BYTES, decodeCrashRecord, signalName } from "@/platform/darwin/crash-record";

describe("crash guard", () => {
	test("decodeCrashRecord reads the fixed 84-byte layout", () => {
		const bytes = new Uint8Array(CRASH_RECORD_BYTES);
		bytes.set([0x43, 0x52, 0x53, 0x48]);
		const view = new DataView(bytes.buffer);
		view.setInt32(4, 11, true);
		view.setInt32(8, 2, true);
		view.setBigUint64(12, 0xdeadbeefn, true);
		bytes.set(new TextEncoder().encode("SIGSEGV"), 20);
		expect(decodeCrashRecord(bytes)).toEqual({
			signal: 11,
			code: 2,
			address: 0xdeadbeefn,
			handler: "SIGSEGV",
		});
		expect(signalName(11)).toBe("SIGSEGV");
		expect(decodeCrashRecord(bytes.subarray(0, 40))).toBeNull();
		expect(decodeCrashRecord(new Uint8Array(CRASH_RECORD_BYTES))).toBeNull();
	});
});
