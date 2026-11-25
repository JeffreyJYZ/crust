/**
 * `perf.sample()` crosses the bridge as `unknown`. Only a shape that the panel can actually read
 * becomes a runtime sample; anything else degrades to the page-only display.
 */
import type { FrameStats } from "./sampler.ts";

export interface PerfSampleLike {
	at: number;
	frame: FrameStats | null;
	runtime: { eventLoopDelayP95: number; heapUsed: number; heapTotal: number };
	invoke: Record<string, { count: number; p50: number; p95: number; errors: number }>;
	events: { emitted: number; delivered: number; dropped: number; p95: number };
	log: { records: number; ms: number };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const hasNumbers = (value: unknown, keys: readonly string[]): boolean =>
	isRecord(value) && keys.every((key) => typeof value[key] === "number");

function isFrame(value: unknown): value is FrameStats {
	return (
		hasNumbers(value, ["framesDrawn", "fps", "p50", "p95", "worst"]) &&
		isRecord(value) &&
		(value.longTasks === null || typeof value.longTasks === "number")
	);
}

export function isPerfSample(value: unknown): value is PerfSampleLike {
	if (!isRecord(value)) return false;
	if (typeof value.at !== "number") return false;
	if (value.frame !== null && !isFrame(value.frame)) return false;
	if (!hasNumbers(value.runtime, ["eventLoopDelayP95", "heapUsed", "heapTotal"])) return false;
	if (!hasNumbers(value.events, ["emitted", "delivered", "dropped", "p95"])) return false;
	if (!hasNumbers(value.log, ["records", "ms"])) return false;
	if (!isRecord(value.invoke)) return false;
	for (const entry of Object.values(value.invoke)) {
		if (!hasNumbers(entry, ["count", "p50", "p95", "errors"])) return false;
	}
	return true;
}
