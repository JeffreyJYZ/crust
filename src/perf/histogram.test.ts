import { describe, expect, test } from "bun:test";
import { Histogram, LATENCY_BOUNDS_MS } from "./histogram.ts";

describe("Histogram", () => {
	test("percentiles are zero until a sample lands", () => {
		const histogram = new Histogram();
		expect(histogram.count).toBe(0);
		expect(histogram.percentile(50)).toBe(0);
		expect(histogram.percentile(95)).toBe(0);
	});

	test("p50 and p95 are positive and ordered", () => {
		const histogram = new Histogram();
		for (let i = 1; i <= 100; i++) histogram.record(i / 1000);
		expect(histogram.count).toBe(100);
		expect(histogram.percentile(50)).toBeGreaterThan(0);
		expect(histogram.percentile(95)).toBeGreaterThanOrEqual(histogram.percentile(50));
		expect(histogram.percentile(100)).toBeLessThanOrEqual(100);
	});

	test("invalid and negative samples are ignored, and reset empties the buckets", () => {
		const histogram = new Histogram();
		histogram.record(Number.NaN);
		histogram.record(Number.POSITIVE_INFINITY);
		histogram.record(-1);
		expect(histogram.count).toBe(0);
		histogram.record(5);
		expect(histogram.count).toBe(1);
		histogram.reset();
		expect(histogram.count).toBe(0);
		expect(histogram.percentile(95)).toBe(0);
	});

	test("recording keeps one fixed bucket array, however much traffic arrives", () => {
		const histogram = new Histogram();
		const boundCount = LATENCY_BOUNDS_MS.length;
		for (let i = 0; i < 10_000; i++) histogram.record(i / 1000);
		expect(LATENCY_BOUNDS_MS.length).toBe(boundCount);
		expect(histogram.count).toBe(10_000);
		expect(histogram.percentile(99)).toBeGreaterThan(0);
		expect(histogram.percentile(99)).toBeLessThanOrEqual(10_000);
	});
});
