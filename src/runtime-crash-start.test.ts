/**
 * The launch half of crash reporting. Two bugs are pinned here: a guard that would not spawn was
 * swallowed with no log (an empty crash feature with no clue why), and the signal handlers were
 * only ever armed by a page's `crash-reporter.install` — so an app that never called it crashed on
 * the default disposition and recorded nothing.
 */

import { describe, expect, test } from "bun:test";

import { type CrashNative, startCrashPart } from "@/runtime-crash-start.ts";

const NATIVE: CrashNative = {
	arm: () => ({ armed: true, reason: "armed" }),
	disarm: () => ({ armed: false, reason: "disarmed" }),
};

const RUNNING = { running: () => true };

/** Collect the warnings a call names, instead of printing them into the test log. */
function captured(run: () => void): string[] {
	const lines: string[] = [];
	const real = console.warn;
	console.warn = (line: string) => {
		lines.push(line);
	};
	try {
		run();
	} finally {
		console.warn = real;
	}
	return lines;
}

describe("startCrashPart", () => {
	test("arms the handlers at launch, before any page asks", () => {
		const records: string[] = [];
		const part = startCrashPart({
			root: "/tmp/crust-crash-root",
			record: "/tmp/crust-crash-root/crash-record.bin",
			start: () => RUNNING,
			native: {
				...NATIVE,
				arm: (record) => {
					records.push(record);
					return { armed: true, reason: "armed" };
				},
			},
			warn: () => {},
		});
		expect(records).toEqual(["/tmp/crust-crash-root/crash-record.bin"]);
		expect(part.armed).toBe(true);
		expect(part.guard).toBe(RUNNING);
	});

	/** A swallowed spawn failure reads as "no crashes"; the reason must reach the log. */
	test("a guard that will not spawn is named and leaves no guard", () => {
		let part: ReturnType<typeof startCrashPart> | undefined;
		const lines = captured(() => {
			part = startCrashPart({
				root: "/tmp/crust-crash-root",
				record: "/tmp/crust-crash-root/crash-record.bin",
				start: () => {
					throw new Error("appDataDir must be a non-empty string");
				},
				native: NATIVE,
				warn: (line) => console.warn(line),
			});
		});
		expect(part?.guard).toBeUndefined();
		expect(part?.armed).toBe(false);
		expect(lines).toHaveLength(1);
		expect(lines[0]).toContain("the guard did not start");
		expect(lines[0]).toContain("appDataDir must be a non-empty string");
	});

	/** Arming a handler no guard reads would promise a record nothing writes. */
	test("a guard that already exited is not armed", () => {
		let armed = 0;
		const part = startCrashPart({
			root: "/tmp/crust-crash-root",
			record: "/tmp/crust-crash-root/crash-record.bin",
			start: () => ({ running: () => false }),
			native: {
				...NATIVE,
				arm: () => {
					armed += 1;
					return { armed: true, reason: "armed" };
				},
			},
			warn: () => {},
		});
		expect(armed).toBe(0);
		expect(part.armed).toBe(false);
	});

	test("handlers that refuse to arm are named", () => {
		const lines: string[] = [];
		const part = startCrashPart({
			root: "/tmp/crust-crash-root",
			record: "/tmp/crust-crash-root/crash-record.bin",
			start: () => RUNNING,
			native: {
				...NATIVE,
				arm: () => ({ armed: false, reason: "refused: no such directory" }),
			},
			warn: (line) => lines.push(line),
		});
		expect(part.armed).toBe(false);
		expect(lines.join("\n")).toContain("refused: no such directory");
	});
});
