/** Shared seams for the overlay tests — no DOM, no timers, no bridge. */
import type { PerfSampleLike } from "./overlay.ts";
import type { Panel } from "./panel.ts";
import type { FrameStats, Sampler } from "./sampler.ts";

export const frame: FrameStats = {
	framesDrawn: 42,
	fps: 55.2,
	p50: 17.1,
	p95: 26.3,
	worst: 40,
	longTasks: null,
};

export function fakeSampler(f: FrameStats = frame): Sampler {
	return {
		frame: () => f,
		readout: () => ({ ...f, elapsedMs: 1000 }),
		start() {},
		stop() {},
		reset() {},
		running: false,
	} as unknown as Sampler;
}

export function fakePanel() {
	const updates: string[][] = [];
	let on = false;
	return {
		updates,
		show() {
			on = true;
		},
		hide() {
			on = false;
		},
		get visible() {
			return on;
		},
		update(lines: string[]) {
			updates.push(lines);
		},
		destroy() {},
	} as unknown as Panel & { updates: string[][] };
}

export const sample: PerfSampleLike = {
	at: 1000,
	frame,
	runtime: { eventLoopDelayP95: 1.2, heapUsed: 12 * 1048576, heapTotal: 20 * 1048576 },
	invoke: { greet: { count: 7, p50: 1, p95: 2, errors: 0 } },
	events: { emitted: 5, delivered: 4, dropped: 1, p95: 0.5 },
	log: { records: 3, ms: 0.2 },
};
