/**
 * `crash-reporter.last/list` read lines from disk through `asStored`. A line that passes the
 * two-field platform guard must not become a typed `StoredCrash` with the wrong field types.
 */
import { describe, expect, test } from "bun:test";
import { asStored } from "./runtime-crash-write.ts";

const VALID = {
	signal: "SIGSEGV",
	code: 1,
	address: "0x0",
	at: "2026-11-16T00:00:00.000Z",
	handler: "SIGSEGV",
	exitCode: 70,
	type: "signal",
} as const;

describe("asStored validates the whole disk record", () => {
	test("a complete record passes and an old record without a type is named signal", () => {
		expect(asStored(VALID)).toEqual(VALID);
		const { type: _old, ...old } = VALID;
		expect(asStored(old)).toMatchObject({ ...old, type: "signal" });
	});

	test("two checked fields alone are not a record", () => {
		expect(asStored({ at: VALID.at, handler: VALID.handler })).toBeNull();
	});

	test("every malformed field is refused instead of typed", () => {
		const bad = [
			{ signal: {} },
			{ code: "x" },
			{ address: 12 },
			{ exitCode: "70" },
			{ message: {} },
			{ stack: [] },
		];
		for (const change of bad) {
			expect(asStored({ ...VALID, ...change })).toBeNull();
		}
	});

	test("nullable fields keep their declared null value", () => {
		expect(
			asStored({ ...VALID, signal: null, code: null, address: null, exitCode: null }),
		).toMatchObject({ signal: null, code: null, address: null, exitCode: null });
	});
});
