import { describe, expect, test } from "bun:test";
import { createSampler } from "./sampler.ts";

/** A clock and a rAF queue the test advances by hand — no browser, no wall time. */
function driver(start = 1000) {
	let at = start;
	let queued: ((now: number) => void) | undefined;
	let ids = 0;
	const raf = (cb: (now: number) => void): number => {
		queued = cb;
		return ++ids;
	};
	const cancelRaf = (): void => {
		queued = undefined;
	};
	return {
		now: () => at,
		raf,
		cancelRaf,
		step(ms = 16.67): void {
			at += ms;
			const cb = queued;
			queued = undefined;
			cb?.(at);
		},
		/** Move the clock without delivering a frame — what an occluded window does. */
		advance(ms: number): void {
			at += ms;
		},
		get pending(): boolean {
			return queued !== undefined;
		},
	};
}

describe("rAF sampler", () => {
	test("counts real frames and reports fps from its own deltas", () => {
		const d = driver();
		const s = createSampler({ raf: d.raf, cancelRaf: d.cancelRaf, now: d.now });
		s.start();
		for (let i = 0; i < 60; i++) d.step();
		const f = s.frame();
		expect(f.framesDrawn).toBe(60);
		expect(f.fps).toBeGreaterThan(50);
		expect(f.fps).toBeLessThan(70);
		expect(f.p95).toBeGreaterThanOrEqual(f.p50);
		expect(f.p50).toBeGreaterThan(0);
		s.stop();
	});

	test("p95 and worst reflect a slow frame", () => {
		const d = driver();
		const s = createSampler({ raf: d.raf, cancelRaf: d.cancelRaf, now: d.now });
		s.start();
		d.step(10);
		d.step(10);
		d.step(40);
		d.step(10);
		const f = s.frame();
		expect(f.worst).toBe(40);
		expect(f.p95).toBeGreaterThanOrEqual(f.p50);
		expect(f.p50).toBe(10);
		s.stop();
	});

	test("longtask is n/a when the observer does not support it", () => {
		class NoLongTask {
			static supportedEntryTypes = ["mark"];
			observe(): void {}
			disconnect(): void {}
		}
		const d = driver();
		const s = createSampler({
			raf: d.raf,
			cancelRaf: d.cancelRaf,
			now: d.now,
			performanceObserver: NoLongTask,
		});
		s.start();
		d.step();
		expect(s.frame().longTasks).toBeNull();
		s.stop();
	});

	test("longtask counts entries when supported and prunes after a second", () => {
		let emit: ((list: { getEntries(): Array<{ startTime: number }> }) => void) | undefined;
		class YesLongTask {
			static supportedEntryTypes = ["longtask"];
			constructor(cb: typeof emit) {
				emit = cb;
			}
			observe(): void {}
			disconnect(): void {}
		}
		const d = driver();
		const s = createSampler({
			raf: d.raf,
			cancelRaf: d.cancelRaf,
			now: d.now,
			performanceObserver: YesLongTask,
		});
		s.start();
		emit?.({ getEntries: () => [{ startTime: d.now() }] });
		expect(s.frame().longTasks).toBe(1);
		d.step(1100);
		expect(s.frame().longTasks).toBe(0);
		s.stop();
	});

	test("no advancing frames is framesDrawn staying still, not a slow app", () => {
		const d = driver();
		const s = createSampler({ raf: d.raf, cancelRaf: d.cancelRaf, now: d.now });
		s.start();
		d.step();
		expect(s.frame().framesDrawn).toBe(1);
		// Clock moves, but nothing steps the rAF queue: nothing was drawn.
		d.advance(1200);
		expect(s.frame().fps).toBe(0);
		expect(s.frame().framesDrawn).toBe(1);
		s.stop();
	});

	test("stop cancels and reset clears without cancelling", () => {
		const d = driver();
		const s = createSampler({ raf: d.raf, cancelRaf: d.cancelRaf, now: d.now });
		s.start();
		d.step();
		s.stop();
		expect(d.pending).toBe(false);
		expect(s.frame().framesDrawn).toBe(1);
		s.reset();
		expect(s.frame().framesDrawn).toBe(0);
	});

	test("a frame older than the 10 s window cannot influence p50 or p95", () => {
		const d = driver();
		const s = createSampler({ raf: d.raf, cancelRaf: d.cancelRaf, now: d.now });
		s.start();
		for (let i = 0; i < 600; i++) d.step(20);
		expect(s.frame().p50).toBe(20);
		for (let i = 0; i < 11_000; i++) d.step(1);
		const late = s.frame();
		expect(late.p50).toBe(1);
		expect(late.p95).toBe(1);
		expect(late.worst).toBe(1);
		s.stop();
	});

	test("restart clears deltas from before the hide", () => {
		const d = driver();
		const s = createSampler({ raf: d.raf, cancelRaf: d.cancelRaf, now: d.now });
		s.start();
		d.step(10);
		d.step(40);
		expect(s.frame().worst).toBe(40);
		s.stop();
		s.start();
		d.step(1);
		d.step(1);
		expect(s.frame().worst).toBe(1);
		s.stop();
	});
});
