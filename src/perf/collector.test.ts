/**
 * The collector's two contracts: when every sink is off nothing allocates and no clock is read;
 * when a sink is on the numbers are real and the accounting adds up exactly. Each test turns its
 * monitor back off, so no timer outlives the test.
 */

import { describe, expect, test } from "bun:test";
import { Collector } from "./collector.ts";
import { buildSample } from "./sample.ts";

const ALL_OFF = { overlay: false, file: false, stdout: false };

function quiet(): Collector {
	const collector = new Collector();
	collector.setSinks(ALL_OFF);
	return collector;
}

describe("collector sinks", () => {
	test("all sinks off by default and independent when set", () => {
		const collector = new Collector();
		expect(collector.sinks).toEqual(ALL_OFF);
		expect(collector.enabled).toBe(false);
		expect(collector.setSinks({ file: true })).toEqual({ ...ALL_OFF, file: true });
		expect(collector.enabled).toBe(true);
		collector.setSinks(ALL_OFF);
		expect(collector.enabled).toBe(false);
	});

	test("off costs no clock reads, but the counters and histograms still accumulate", () => {
		const collector = quiet();
		const original = performance.now.bind(performance);
		let reads = 0;
		performance.now = () => {
			reads++;
			return original();
		};
		try {
			for (let i = 0; i < 10_000; i++) {
				collector.beforeInvoke("alpha");
				collector.afterInvoke("alpha", 0.5);
				collector.recordError("alpha");
				collector.recordEmit();
				collector.recordDelivery();
				collector.recordDrop();
				collector.recordLog(1);
			}
		} finally {
			performance.now = original;
		}
		expect(reads).toBe(0);
		const alpha = collector.invokes.get("alpha");
		expect(alpha?.count).toBe(10_000);
		expect(alpha?.errors).toBe(10_000);
		expect(alpha?.latency.count).toBe(10_000);
		expect(collector.events).toMatchObject({
			emitted: 10_000,
			delivered: 10_000,
			dropped: 10_000,
		});
		expect(collector.log).toEqual({ records: 10_000, ms: 10_000 });
		expect(collector.eventLoopDelayP95()).toBe(0);
	});

	test("on reports real invoke, event and heap numbers", () => {
		const collector = quiet();
		try {
			collector.setSinks({ overlay: true });
			for (let i = 1; i <= 50; i++) {
				collector.beforeInvoke("alpha");
				collector.afterInvoke("alpha", i / 1000);
				collector.recordEmit(i / 1000);
				collector.recordDelivery();
				collector.recordLog(0.5);
			}
			collector.recordError("alpha");
			collector.recordDrop();
			const sample = buildSample(collector, collector.startedAt + 100);
			expect(sample.frame).toBeNull();
			const alpha = sample.invoke.alpha;
			expect(alpha?.count).toBe(50);
			expect(alpha?.errors).toBe(1);
			expect(alpha?.p50).toBeGreaterThan(0);
			expect(alpha?.p95).toBeGreaterThanOrEqual(alpha?.p50 ?? 0);
			expect(sample.events.emitted - sample.events.delivered).toBe(0);
			expect(sample.events.dropped).toBe(1);
			expect(sample.events.p95).toBeGreaterThan(0);
			expect(sample.log).toEqual({ records: 50, ms: 25 });
			expect(sample.runtime.heapUsed).toBeGreaterThan(0);
			// Bun's `heapTotal` is JSC capacity, not a superset of `heapUsed`; both are reported as read.
			expect(sample.runtime.heapTotal).toBeGreaterThan(0);
			expect(sample.at).toBe(100);
		} finally {
			collector.setSinks(ALL_OFF);
		}
	});

	test("frame is null until a page half reports, then round-trips unchanged", () => {
		const collector = quiet();
		expect(buildSample(collector, collector.startedAt).frame).toBeNull();
		const frame = { framesDrawn: 56, fps: 56, p50: 17, p95: 26, worst: 40, longTasks: 0 };
		collector.reportFrame(frame);
		expect(buildSample(collector, collector.startedAt).frame).toEqual(frame);
		collector.reset();
		expect(buildSample(collector, collector.startedAt).frame).toBeNull();
	});
});

describe("accounting is exact", () => {
	test("N invokes across two plugins sum to N", () => {
		const collector = quiet();
		try {
			collector.setSinks({ stdout: true });
			for (let i = 0; i < 137; i++) {
				const name = i % 3 === 0 ? "alpha" : "beta";
				collector.beforeInvoke(name);
				collector.afterInvoke(name, 1);
			}
			const alpha = collector.invokes.get("alpha")?.count ?? 0;
			const beta = collector.invokes.get("beta")?.count ?? 0;
			const sum = [...collector.invokes.values()].reduce((n, stat) => n + stat.count, 0);
			console.log(`invoke accounting: alpha=${alpha} beta=${beta} sum=${sum} expected=137`);
			expect(sum).toBe(137);
			expect(collector.invokes.size).toBe(2);
		} finally {
			collector.setSinks(ALL_OFF);
		}
	});

	test("emitted minus delivered equals the queue deliberately left undelivered", () => {
		const collector = quiet();
		try {
			collector.setSinks({ stdout: true });
			for (let i = 0; i < 200; i++) {
				collector.recordEmit();
				if (i < 173) collector.recordDelivery();
				if (i === 180) collector.recordDrop();
			}
			const queue = collector.events.emitted - collector.events.delivered;
			console.log(
				`event accounting: emitted=${collector.events.emitted} delivered=${collector.events.delivered} queue=${queue} dropped=${collector.events.dropped}`,
			);
			expect(queue).toBe(27);
			expect(collector.events.dropped).toBe(1);
		} finally {
			collector.setSinks(ALL_OFF);
		}
	});
});
