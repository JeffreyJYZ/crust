/**
 * The runtime half of the profiler: one counter set per plugin name, allocated on first use, and
 * one bounded histogram per name. Sinks only decide who reads the numbers, not whether they exist:
 * increments and bounded pushes run even with every sink off, so `sample()` can report what happened
 * before anyone started watching. The collector itself never reads a clock — `afterInvoke` takes the
 * duration the bridge already measured for its own log record. `buildSample` is the only allocator.
 *
 * `monitorEventLoopDelay` is created on the first enable and disabled (never discarded) on the last
 * one, so toggling sinks does not allocate a monitor per toggle. Heap is read only by `buildSample`
 * on the sample tick, never here.
 */

import { monitorEventLoopDelay } from "node:perf_hooks";
import { Histogram } from "./histogram.ts";
import type { FrameStats } from "./sample.ts";

export interface Sinks {
	overlay: boolean;
	file: boolean;
	stdout: boolean;
}

export interface InvokeStat {
	count: number;
	errors: number;
	latency: Histogram;
}

export interface EventStat {
	emitted: number;
	delivered: number;
	dropped: number;
	latency: Histogram;
}

export interface LogStat {
	records: number;
	ms: number;
}

const EMPTY_EVENTS: EventStat = {
	emitted: 0,
	delivered: 0,
	dropped: 0,
	latency: new Histogram(),
};
const EMPTY_LOG: LogStat = { records: 0, ms: 0 };
const DELAY_RESOLUTION_MS = 1;
const NS_PER_MS = 1e6;

export class Collector {
	readonly sinks: Sinks = { overlay: false, file: false, stdout: false };
	/** The one flag the hot path reads. Mutated only by `setSinks`. */
	enabled = false;
	readonly startedAt = Date.now();
	readonly invokes = new Map<string, InvokeStat>();

	private mountedFlag = false;
	private eventsStat: EventStat | undefined;
	private logStat: LogStat | undefined;
	private delay: ReturnType<typeof monitorEventLoopDelay> | undefined;
	private frameStat: FrameStats | null = null;

	get mounted(): boolean {
		return this.mountedFlag;
	}

	mount(): void {
		this.mountedFlag = true;
	}

	unmount(): void {
		this.mountedFlag = false;
	}

	/** Turn sinks on or off; independent flags, and `enabled` is their union. */
	setSinks(next: Partial<Sinks>): Sinks {
		if (next.overlay !== undefined) this.sinks.overlay = next.overlay;
		if (next.file !== undefined) this.sinks.file = next.file;
		if (next.stdout !== undefined) this.sinks.stdout = next.stdout;
		const enabled = this.sinks.overlay || this.sinks.file || this.sinks.stdout;
		if (enabled === this.enabled) return this.sinks;
		this.enabled = enabled;
		if (enabled) this.startDelay();
		else this.delay?.disable();
		return this.sinks;
	}

	private startDelay(): void {
		if (this.delay === undefined) {
			this.delay = monitorEventLoopDelay({ resolution: DELAY_RESOLUTION_MS });
		}
		this.delay.enable();
	}

	private stat(plugin: string): InvokeStat {
		let stat = this.invokes.get(plugin);
		if (stat === undefined) {
			stat = { count: 0, errors: 0, latency: new Histogram() };
			this.invokes.set(plugin, stat);
		}
		return stat;
	}

	/** Increments run with sinks off: a sample taken after enabling must include earlier invokes. */
	beforeInvoke(plugin: string): void {
		this.stat(plugin).count++;
	}

	/** `durMs` is the duration the bridge already measured for its own record — no extra clock read. */
	afterInvoke(plugin: string, durMs: number): void {
		this.stat(plugin).latency.record(durMs);
	}

	recordError(plugin: string): void {
		this.stat(plugin).errors++;
	}

	private event(): EventStat {
		if (this.eventsStat === undefined) {
			this.eventsStat = { emitted: 0, delivered: 0, dropped: 0, latency: new Histogram() };
		}
		return this.eventsStat;
	}

	recordEmit(latencyMs = 0): void {
		const stat = this.event();
		stat.emitted++;
		stat.latency.record(latencyMs);
	}

	recordDelivery(): void {
		this.event().delivered++;
	}

	recordDrop(): void {
		this.event().dropped++;
	}

	recordLog(ms: number): void {
		if (this.logStat === undefined) this.logStat = { records: 0, ms: 0 };
		this.logStat.records++;
		this.logStat.ms += ms;
	}

	/** The page's own compositor view. Kept as `null` until a page half reports one. */
	reportFrame(frame: FrameStats): void {
		this.frameStat = frame;
	}

	get frame(): FrameStats | null {
		return this.frameStat;
	}

	get events(): EventStat {
		return this.eventsStat ?? EMPTY_EVENTS;
	}

	get log(): LogStat {
		return this.logStat ?? EMPTY_LOG;
	}

	eventLoopDelayP95(): number {
		return this.delay === undefined ? 0 : Number(this.delay.percentile(95)) / NS_PER_MS;
	}

	/** Zero the counters; sinks and mounting survive, so a sampling client keeps its config. */
	reset(): void {
		this.invokes.clear();
		this.eventsStat = undefined;
		this.logStat = undefined;
		this.frameStat = null;
		this.delay?.reset();
	}
}

export const perfCollector = new Collector();
