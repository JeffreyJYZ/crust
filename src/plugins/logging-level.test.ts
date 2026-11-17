/**
 * `crust:logging` cross-level proofs. The level table is ordered by chattiness: error is the quietest
 * and trace the noisiest. A single-level test cannot catch an inverted table, so these write one level
 * against another threshold and assert which side of the filter it lands on.
 */

import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createLoggingPlugin, type LogLevel } from "@/plugins/logging";

interface WriteResult {
	written: boolean;
	reason?: string;
}

/** One write in a fresh temp root, so the ring of one case cannot affect another. */
async function writeAt(
	level: LogLevel,
	message: string,
	threshold?: LogLevel,
): Promise<WriteResult> {
	const root = await mkdtemp(join(tmpdir(), "crust-logging-level-"));
	try {
		const plugin = createLoggingPlugin({ root, level: threshold, now: () => 0 });
		const table = plugin.commands as unknown as Record<
			string,
			(input?: unknown) => Promise<WriteResult>
		>;
		const write = table.write;
		if (write === undefined) throw new Error("no command write");
		return await write({ level, message });
	} finally {
		await rm(root, { recursive: true, force: true });
	}
}

describe("logging level ordering", () => {
	test("trace is the chattiest: dropped at info, admitted at trace", async () => {
		expect(await writeAt("trace", "noise")).toEqual({ written: false, reason: "below-level" });
		expect((await writeAt("trace", "noise", "trace")).written).toBe(true);
	});

	test("the trace threshold admits every quieter level", async () => {
		for (const level of ["error", "warn", "info", "debug"] as const) {
			expect(
				(await writeAt(level, level, "trace")).written,
				`trace threshold admits ${level}`,
			).toBe(true);
		}
	});

	test("error survives every threshold; debug only from debug upward", async () => {
		for (const threshold of ["error", "warn", "info", "debug", "trace"] as const) {
			expect(
				(await writeAt("error", "boom", threshold)).written,
				`${threshold} admits error`,
			).toBe(true);
		}
		expect(await writeAt("debug", "detail", "warn")).toEqual({
			written: false,
			reason: "below-level",
		});
		expect((await writeAt("debug", "detail", "debug")).written).toBe(true);
	});
});
