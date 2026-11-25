import { describe, expect, test } from "bun:test";
import type { PerfSample } from "@/perf";
import { verdict } from "./record.ts";
import { diffRecords } from "./diff.ts";
import { idleWindowCount, summaryOf } from "./format.ts";
import type { PerfRecordFile } from "./types.ts";

/** A sampler fixture: no WebKit, so a stalled run and an idle one can be forced deterministically. */
function stub(drawn: number, fps: number, at: number): PerfSample {
	return {
		at,
		frame: { framesDrawn: drawn, fps, p50: 12, p95: 20, worst: 40, longTasks: 0 },
		runtime: { eventLoopDelayP95: 1, heapUsed: 1000, heapTotal: 2000 },
		invoke: {},
		events: { emitted: 0, delivered: 0, dropped: 0, p95: 0 },
		log: { records: 0, ms: 0 },
	};
}

function fileOf(samples: PerfSample[]): PerfRecordFile {
	const summary = summaryOf(samples);
	if (summary === undefined) throw new Error("fixture has no summary");
	return {
		version: 1,
		meta: {
			app: "fixture",
			seconds: samples.length,
			occlusionDetectionEnabled: false,
			occlusionState: 2,
			keepAwake: true,
			activation: "none",
			processesBefore: 1,
			processesAfter: 1,
			recordedAt: "2026-01-01T00:00:00.000Z",
		},
		summary,
		samples,
	};
}

describe("perf record verdict", () => {
	test("a run where the sampler never painted is a failure: no sample may read as fast", () => {
		const samples = [stub(0, 0, 1000), stub(0, 0, 2000), stub(0, 0, 3000)];
		const decision = verdict(samples);
		expect(decision.ok).toBe(false);
		if (decision.ok) return;
		expect(decision.reason).toContain("occluded or suspended WebView");
		expect(decision.reason).toContain("no sample written");
		expect(summaryOf(samples)?.frame.idleWindows).toBe(2);
	});

	test("drew then idle is a valid sample, with idle windows recorded", () => {
		// The static-app case: the first window painted, later ones did not advance and fps is 0.
		const samples = [stub(96, 36, 1000), stub(96, 0, 2000), stub(96, 0, 3000)];
		expect(verdict(samples).ok).toBe(true);
		const summary = summaryOf(samples);
		if (summary === undefined) throw new Error("idle run has no summary");
		expect(summary.frame.framesDrawn).toBe(96);
		expect(summary.frame.fps).toBe(0);
		expect(summary.frame.idleWindows).toBe(2);
		expect(idleWindowCount(samples)).toBe(2);
	});

	test("animating draws no idle windows and stays valid", () => {
		const samples = [stub(36, 36, 1000), stub(72, 36, 2000), stub(108, 36, 3000)];
		expect(verdict(samples).ok).toBe(true);
		expect(summaryOf(samples)?.frame.idleWindows).toBe(0);
	});

	test("diff shows idle windows with a per-field direction", () => {
		const before = fileOf([stub(36, 36, 1000), stub(72, 36, 2000)]);
		const after = structuredClone(before);
		after.summary.frame.idleWindows = 1;
		const stopped = diffRecords(before, after, 5);
		expect(typeof stopped).not.toBe("string");
		if (typeof stopped === "string") return;
		expect(stopped.lines.find((line) => line.includes("frame.idleWindows"))).toContain(
			"REGRESS",
		);
		expect(stopped.regressions.some((line) => line.includes("frame.idleWindows"))).toBe(true);

		// The opposite direction is not a regression: fewer idle windows means more painting.
		const resumed = structuredClone(after);
		resumed.summary.frame.idleWindows = 0;
		const result = diffRecords(after, resumed, 5);
		expect(typeof result).not.toBe("string");
		if (typeof result === "string") return;
		expect(result.regressions).toEqual([]);
	});
});
