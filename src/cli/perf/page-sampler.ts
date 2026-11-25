/**
 * Bundled into the page by `perf record` and injected through the WebView evaluator. It reuses the
 * overlay's rAF sampler — the recorder must not invent a second frame counter — and hands one
 * last-writer-wins block to `perf.frameReport` each second. Nothing here listens to runtime counters.
 */

import { createSampler } from "../../perf/overlay/sampler.ts";

interface PerfApi {
	frameReport(frame: unknown): unknown;
}

interface CrustApi {
	invoke(plugin: string, command: string, args?: unknown): unknown;
	perf?: PerfApi;
}

const scope = globalThis as unknown as Record<string, unknown>;
const crust = scope.crust as CrustApi | undefined;
if (crust === undefined || typeof crust.invoke !== "function") {
	throw new Error("crust perf sampler: the bridge client is not installed in this page");
}
const report: PerfApi["frameReport"] =
	typeof crust.perf?.frameReport === "function"
		? (frame) => crust.perf?.frameReport?.(frame)
		: (frame) => crust.invoke("perf", "frameReport", frame);
if (scope.__crustPerfRecorderSampler === undefined) {
	const sampler = createSampler();
	sampler.start();
	scope.__crustPerfRecorderSampler = sampler;
	setInterval(() => {
		const frame = sampler.frame();
		scope.__crustPerfRecorderLastReport = report({
			...frame,
			longTasks: frame.longTasks ?? 0,
		});
	}, 1000);
}
