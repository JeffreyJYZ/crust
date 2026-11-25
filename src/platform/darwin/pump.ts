/**
 * The pump timer: Cocoa's run loop driven from a self-rearming `setTimeout` chain, plus the one
 * per-tick hook a native surface needs. Its own module because `platform.ts` is at the line cap and
 * this is a separate responsibility — a timer, not AppKit lifecycle.
 * A repeating interval would coalesce under power saving, so each tick re-arms itself.
 */
/** The shim's -1 means every window is occluded, so WebKit has stopped painting. */
export const OCCLUDED_PUMP_INTERVAL_MS = 100;

/**
 * Progress clock for waits that must survive a starved runner. It advances by one scheduling
 * interval per native tick, never by wall time: a stalled loop delivers neither the answer nor
 * progress, so a deadline measured here pauses with the loop instead of firing against it.
 */
let progressMs = 0;
export const pumpProgressMs = (): number => progressMs;

export interface Pump {
	start(intervalMs: number, tick: () => unknown, slowMs?: number): void;
	stop(): void;
	readonly pumping: boolean;
	readonly ticks: number;
}

export interface PumpOptions {
	/**
	 * Runs before every Cocoa tick. The preview panel is a window of its own, and a window closed with
	 * its red button never reaches `Platform.destroy`, so this is where that panel is ordered out with
	 * it. Free when no panel was ever shown.
	 */
	beforeTick?: () => void;
}

/** Opt-in perf accounting: off by default, so the shipped pump has no clock reads or sample array. */
const STATS = process.env.CRUST_PUMP_STATS === "1";
const SAMPLE_CAP = 4096;
const REPORT_EVERY = 120;

export function createPump(options: PumpOptions = {}): Pump {
	let running = false;
	let timer: ReturnType<typeof setTimeout> | undefined;
	let count = 0;
	const samples = STATS ? new Float64Array(SAMPLE_CAP) : undefined;
	let filled = 0;
	let total = 0;
	let started = 0;
	let reported = 0;

	const stop = (): void => {
		running = false;
		if (timer !== undefined) clearTimeout(timer);
		timer = undefined;
	};

	const start = (
		intervalMs: number,
		tick: () => unknown,
		slowMs: number = OCCLUDED_PUMP_INTERVAL_MS,
	): void => {
		if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
			throw new Error(`pump: intervalMs must be a positive number, got ${intervalMs}`);
		}
		if (!Number.isFinite(slowMs) || slowMs <= 0) {
			throw new Error(`pump: slowMs must be a positive number, got ${slowMs}`);
		}
		if (running) stop();
		running = true;
		if (samples) started = performance.now();
		const step = (): void => {
			if (!running) return;
			const begin = samples ? performance.now() : 0;
			options.beforeTick?.();
			// A null from an unbound shim symbol is a normal tick; only -1 means occluded.
			const status = Number(tick() ?? 0);
			count++;
			const interval = status === -1 ? slowMs : intervalMs;
			progressMs += interval;
			if (samples) {
				const elapsed = performance.now() - begin;
				total += elapsed;
				samples[filled++ % SAMPLE_CAP] = elapsed;
				if (filled - reported >= REPORT_EVERY) {
					reported = filled;
					const take = Math.min(filled, SAMPLE_CAP);
					const sorted = Array.from(samples.subarray(0, take)).sort((a, b) => a - b);
					const seconds = (performance.now() - started) / 1000;
					console.log(
						`PUMPSTATS count=${count} tps=${(count / seconds).toFixed(1)} ` +
							`mean=${(total / filled).toFixed(3)} p95=${sorted[Math.floor(take * 0.95)]?.toFixed(3)} ` +
							`max=${sorted[take - 1]?.toFixed(3)}`,
					);
				}
			}
			timer = setTimeout(step, interval);
		};
		step();
	};

	return {
		start,
		stop,
		get pumping() {
			return running;
		},
		get ticks() {
			return count;
		},
	};
}
