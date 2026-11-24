/**
 * `perf` — the page-facing commands over the one runtime collector. The plugin is opt-in: a
 * collector starts unmounted, and every answer is a typed `not-implemented` naming the requirement
 * until `createPerfPlugin` mounts it. Nothing here imports the overlay, so a production bundle that
 * never mounts `perf` never pulls overlay code in.
 *
 * Frame contract for the two consumers of this seam: the page half measures its own
 * `requestAnimationFrame` deltas and hands them over with `frameReport({ framesDrawn, fps, p50, p95,
 * worst, longTasks })`; both the overlay and `crust perf record` call `sample()` afterwards and get
 * that last reported block. Until a page reports, `sample().frame` is `null`, never a zero-filled
 * object — an occluded window draws zero frames and that is a different fact from "no page half".
 * Recorder failure is `framesDrawn === 0`, not a low fps value.
 */

import { perfCollector, type Collector, type Sinks } from "@/perf/collector";
import { buildSample, type FrameStats, type PerfSample } from "@/perf/sample";
import { definePlugin, notImplemented, type NotImplemented } from "./define";

/** The `requires` string a page sees when nobody mounted the plugin. */
export const PERF_REQUIRES = "perf plugin mounted";

export interface OverlayArgs {
	enabled: boolean;
}

export interface OverlayResult {
	enabled: boolean;
}

type Refusal = NotImplemented;

function refusal(collector: Collector): Refusal | undefined {
	return collector.mounted
		? undefined
		: notImplemented("perf is not mounted in this app", PERF_REQUIRES);
}

/**
 * The command map is exported on its own so the refusal can be tested without mounting: a page that
 * reaches `perf` before registration must get a typed answer, not an unknown-command error.
 */
export function createPerfCommands(
	collector: Collector = perfCollector,
	now: () => number = () => performance.now(),
) {
	return {
		sample(): PerfSample | Refusal {
			const denied = refusal(collector);
			if (denied !== undefined) return denied;
			return buildSample(collector, now());
		},
		frameReport(frame: FrameStats): { ok: true } | Refusal {
			const denied = refusal(collector);
			if (denied !== undefined) return denied;
			collector.reportFrame(frame);
			return { ok: true };
		},
		overlay({ enabled }: OverlayArgs = { enabled: false }): OverlayResult | Refusal {
			const denied = refusal(collector);
			if (denied !== undefined) return denied;
			collector.setSinks({ overlay: enabled });
			return { enabled: collector.sinks.overlay };
		},
		sinks(next: Partial<Sinks> = {}): Sinks | Refusal {
			const denied = refusal(collector);
			if (denied !== undefined) return denied;
			collector.setSinks(next);
			return { ...collector.sinks };
		},
		reset(): { ok: true } | Refusal {
			const denied = refusal(collector);
			if (denied !== undefined) return denied;
			collector.reset();
			return { ok: true };
		},
	};
}

export function createPerfPlugin(collector: Collector = perfCollector, now?: () => number) {
	collector.mount();
	const commands = createPerfCommands(collector, now);
	return definePlugin({ name: "perf", commands });
}
