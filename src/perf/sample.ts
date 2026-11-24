/**
 * The one record type the overlay, the recorder and the CLI all read. Building a sample is a tick
 * operation: it walks the counters once and reads `process.memoryUsage()` here, never per invoke.
 *
 * The backend cannot see frames: only the page sees its own `requestAnimationFrame` deltas. An
 * occluded window paints nothing at all (0 fps), so inventing a zero-filled frame block would read
 * as "slow" when the truth is "not painting". `frame` stays `null` until the page half hands one
 * over through `perf.frameReport(...)`; both the overlay and `crust perf record` use that path.
 */

import type { Collector } from "./collector.ts";

export interface FrameStats {
	/** Frames actually drawn. Zero means nothing painted; the recorder fails on it, not on low fps. */
	framesDrawn: number;
	fps: number;
	p50: number;
	p95: number;
	worst: number;
	longTasks: number;
}

export interface PerfSample {
	at: number;
	/** `null` means no page half reported frames — never a zero-filled block. */
	frame: FrameStats | null;
	runtime: {
		eventLoopDelayP95: number;
		heapUsed: number;
		heapTotal: number;
	};
	invoke: Record<string, { count: number; p50: number; p95: number; errors: number }>;
	events: { emitted: number; delivered: number; dropped: number; p95: number };
	log: { records: number; ms: number };
}

export function buildSample(collector: Collector, now: number): PerfSample {
	const invoke: PerfSample["invoke"] = {};
	for (const [name, stat] of collector.invokes) {
		invoke[name] = {
			count: stat.count,
			p50: stat.latency.percentile(50),
			p95: stat.latency.percentile(95),
			errors: stat.errors,
		};
	}
	const events = collector.events;
	const log = collector.log;
	const heap = process.memoryUsage();
	return {
		at: now - collector.startedAt,
		frame: collector.frame,
		runtime: {
			eventLoopDelayP95: collector.eventLoopDelayP95(),
			heapUsed: heap.heapUsed,
			heapTotal: heap.heapTotal,
		},
		invoke,
		events: {
			emitted: events.emitted,
			delivered: events.delivered,
			dropped: events.dropped,
			p95: events.latency.percentile(95),
		},
		log: { records: log.records, ms: log.ms },
	};
}
