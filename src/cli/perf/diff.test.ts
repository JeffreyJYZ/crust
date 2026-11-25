import { describe, expect, test } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Collector, buildSample } from "@/perf";
import { summaryOf } from "./format.ts";
import { delta, diffFiles, diffRecords } from "./diff.ts";
import type { PerfRecordFile } from "./types.ts";

function fixture(): PerfRecordFile {
	const collector = new Collector();
	collector.reportFrame({ framesDrawn: 120, fps: 60, p50: 12, p95: 20, worst: 40, longTasks: 1 });
	const sample = buildSample(collector, 1000);
	const summary = summaryOf([sample]);
	if (summary === undefined) throw new Error("fixture has no summary");
	return {
		version: 1,
		meta: {
			app: "fixture",
			seconds: 1,
			occlusionDetectionEnabled: false,
			occlusionStates: [2],
			occludedWindows: [],
			occlusionTransitions: 0,
			occlusionState: 2,
			keepAwake: true,
			activation: "none",
			processesBefore: 1,
			processesAfter: 1,
			recordedAt: "2026-01-01T00:00:00.000Z",
		},
		summary,
		samples: [sample],
	};
}

describe("perf diff", () => {
	test("round-trip: same file reports zero delta and exit 0", async () => {
		const file = fixture();
		const result = diffRecords(file, file, 5);
		expect(typeof result).not.toBe("string");
		if (typeof result === "string") return;
		expect(result.regressions).toEqual([]);
		expect(
			result.lines.some((line) => line.includes("frame.p95") && line.includes("+0.0%")),
		).toBe(true);
		const dir = await mkdtemp(join(tmpdir(), "crust-perf-diff-"));
		const path = join(dir, "same.json");
		await writeFile(path, JSON.stringify(file), "utf8");
		expect(await diffFiles(path, path, 5)).toBe(0);
	});

	test("a p95 regression names the field and both numbers", async () => {
		const before = fixture();
		const after = structuredClone(before);
		after.summary.frame.p95 = 30;
		const result = diffRecords(before, after, 5);
		expect(typeof result).not.toBe("string");
		if (typeof result === "string") return;
		expect(result.regressions.length).toBe(1);
		const line = result.regressions[0] ?? "";
		expect(line).toContain("frame.p95");
		expect(line).toContain("20.00 -> 30.00");
		expect(result.lines.find((row) => row.includes("frame.p95"))).toContain("REGRESS");
		const dir = await mkdtemp(join(tmpdir(), "crust-perf-diff-"));
		const a = join(dir, "a.json");
		const b = join(dir, "b.json");
		await writeFile(a, JSON.stringify(before), "utf8");
		await writeFile(b, JSON.stringify(after), "utf8");
		expect(await diffFiles(a, b, 5)).toBe(1);
	});

	test("direction is per field: a faster frame time is not a regression", () => {
		const before = fixture();
		const after = structuredClone(before);
		after.summary.frame.p95 = 10;
		after.summary.frame.fps = 90;
		const result = diffRecords(before, after, 5);
		expect(typeof result).not.toBe("string");
		if (typeof result === "string") return;
		expect(result.regressions).toEqual([]);
	});

	test("cumulative counters are compared per second, not across run lengths", () => {
		const before = fixture();
		before.meta.seconds = 10;
		before.summary.frame.framesDrawn = 600;
		before.summary.invokeThroughput = 100;
		const after = structuredClone(before);
		after.meta.seconds = 1;
		after.summary.frame.framesDrawn = 60;
		after.summary.invokeThroughput = 10;
		const result = diffRecords(before, after, 5);
		expect(typeof result).not.toBe("string");
		if (typeof result === "string") return;
		expect(result.regressions).toEqual([]);
		expect(result.lines.find((line) => line.includes("throughput"))).toContain("+0.0%");
	});

	test("a from-zero delta keeps its sign and honours tolerance", () => {
		expect(delta(0, 5, "higher", 1).pct).toBe(100);
		expect(delta(0, 5, "lower", 100).bad).toBe(false);
		expect(delta(0, 5, "lower", 5).bad).toBe(true);
	});
});
