/**
 * The page half's only honest source of frame numbers: its own `requestAnimationFrame` deltas.
 * The runtime cannot see these, so nothing here reads a bridge counter. One callback per frame,
 * one number pushed per callback, no object allocated on the hot path. A window that draws
 * nothing keeps `framesDrawn` still — callers must show "no frames", never "0 fps", because an
 * occluded window is not a slow app.
 */

export interface FrameStats {
	/** Cumulative frames this sampler has actually seen. */
	framesDrawn: number;
	/** Frames in the last second, per second. */
	fps: number;
	p50: number;
	p95: number;
	worst: number;
	/** `null` means the webview has no `longtask` observer — render `n/a`, not `0`. */
	longTasks: number | null;
}

export interface SamplerOptions {
	/** Injected by a test; a page uses its own `requestAnimationFrame`. */
	raf?: (cb: (now: number) => void) => number;
	cancelRaf?: (id: number) => void;
	now?: () => number;
	/** Rolling frame-time window in ms. Default 10 s, the sparkline's span. */
	windowMs?: number;
	/** Injected by a test where `PerformanceObserver` is absent or unsupported. */
	performanceObserver?: unknown;
}

type Raf = (cb: (now: number) => void) => number;
type Observer = {
	observe: (args: { type: string }) => void;
	disconnect: () => void;
};
type ObserverCtor = new (
	cb: (list: { getEntries(): Array<{ startTime: number }> }) => void,
) => Observer;

function percentile(sorted: number[], fraction: number): number {
	if (sorted.length === 0) return 0;
	const at = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * fraction) - 1));
	return sorted[at] ?? 0;
}

/**
 * A rAF delta collector. `start()` is idempotent, `stop()` cancels the callback and disconnects
 * the observer, and `reset()` clears the accounting without cancelling anything.
 */
export function createSampler(options: SamplerOptions = {}) {
	const globals = globalThis as Record<string, unknown>;
	const raf: Raf = options.raf ?? (globals.requestAnimationFrame as Raf | undefined) ?? (() => 0);
	const cancelRaf =
		options.cancelRaf ??
		(globals.cancelAnimationFrame as ((id: number) => void) | undefined) ??
		(() => {});
	const now = options.now ?? (() => performance.now());
	const windowMs = options.windowMs ?? 10_000;
	const ObserverClass = (options.performanceObserver ?? globals.PerformanceObserver) as
		ObserverCtor | undefined;
	const supported =
		ObserverClass !== undefined &&
		Array.isArray(
			(ObserverClass as unknown as { supportedEntryTypes?: unknown }).supportedEntryTypes,
		) &&
		(
			ObserverClass as unknown as { supportedEntryTypes: readonly string[] }
		).supportedEntryTypes.includes("longtask");

	const stamps: number[] = [];
	// Deltas need their own timestamps: `stamps` is trimmed to one second for fps, so testing it
	// against a ten-second window would never expire a delta.
	const deltaStamps: number[] = [];
	const deltas: number[] = [];
	const longTaskStamps: number[] = [];
	let framesDrawn = 0;
	let lastFrame = 0;
	let handle = 0;
	let running = false;
	let observer: Observer | undefined;
	let startedAt = now();

	if (supported && ObserverClass !== undefined) {
		try {
			observer = new ObserverClass((list) => {
				for (const entry of list.getEntries()) {
					if (entry.startTime > 0) longTaskStamps.push(now());
				}
			});
			observer.observe({ type: "longtask" });
		} catch {
			observer = undefined;
		}
	}

	function prune(at: number): void {
		while (stamps.length > 0 && (stamps[0] ?? 0) < at - 1000) stamps.shift();
		while (deltaStamps.length > 0 && (deltaStamps[0] ?? 0) < at - windowMs) {
			deltaStamps.shift();
			deltas.shift();
		}
		while (longTaskStamps.length > 0 && (longTaskStamps[0] ?? 0) < at - 1000)
			longTaskStamps.shift();
	}

	function tick(at: number): void {
		if (!running) return;
		framesDrawn += 1;
		stamps.push(at);
		if (lastFrame !== 0) {
			deltas.push(at - lastFrame);
			deltaStamps.push(at);
		}
		lastFrame = at;
		prune(at);
		handle = raf(tick);
	}

	function frame(): FrameStats {
		const at = now();
		prune(at);
		const sorted = [...deltas].sort((a, b) => a - b);
		const span = Math.max(1, Math.min(1000, at - startedAt));
		let worst = 0;
		for (const delta of deltas) if (delta > worst) worst = delta;
		return {
			framesDrawn,
			fps: (stamps.length * 1000) / span,
			p50: percentile(sorted, 0.5),
			p95: percentile(sorted, 0.95),
			worst,
			longTasks: supported ? longTaskStamps.length : null,
		};
	}

	return {
		start(): void {
			if (running) return;
			running = true;
			// A hide/show must not mix frames from before the hide into the new window.
			stamps.length = 0;
			deltaStamps.length = 0;
			deltas.length = 0;
			longTaskStamps.length = 0;
			startedAt = now();
			lastFrame = 0;
			handle = raf(tick);
		},
		stop(): void {
			running = false;
			cancelRaf(handle);
			observer?.disconnect();
			observer = undefined;
		},
		reset(): void {
			stamps.length = 0;
			deltaStamps.length = 0;
			deltas.length = 0;
			longTaskStamps.length = 0;
			framesDrawn = 0;
			lastFrame = 0;
			startedAt = now();
		},
		frame,
		/** The same numbers, plus the wall span, so a probe can compare two counters at one instant. */
		readout(): FrameStats & { elapsedMs: number } {
			return { ...frame(), elapsedMs: now() - startedAt };
		},
		get running(): boolean {
			return running;
		},
	};
}

export type Sampler = ReturnType<typeof createSampler>;
