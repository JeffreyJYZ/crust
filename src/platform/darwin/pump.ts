/**
 * The pump timer: Cocoa's run loop driven from a self-rearming `setTimeout` chain, plus the one
 * per-tick hook a native surface needs. Its own module because `platform.ts` is at the line cap and
 * this is a separate responsibility — a timer, not AppKit lifecycle.
 * A repeating interval would coalesce under power saving, so each tick re-arms itself.
 */
export interface Pump {
	start(intervalMs: number, tick: () => void): void;
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

export function createPump(options: PumpOptions = {}): Pump {
	let running = false;
	let timer: ReturnType<typeof setTimeout> | undefined;
	let count = 0;

	const stop = (): void => {
		running = false;
		if (timer !== undefined) clearTimeout(timer);
		timer = undefined;
	};

	const start = (intervalMs: number, tick: () => void): void => {
		if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
			throw new Error(`pump: intervalMs must be a positive number, got ${intervalMs}`);
		}
		if (running) stop();
		running = true;
		const step = (): void => {
			if (!running) return;
			options.beforeTick?.();
			tick();
			count++;
			timer = setTimeout(step, intervalMs);
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
