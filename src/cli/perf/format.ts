/** Headline and summary formatting for `perf record` — one sample, no second measurement. */

import type { PerfSample } from "@/perf";
import type { Summary } from "./types.ts";

const MB = 1_048_576;

/** The last pulled sample is the headline; earlier samples travel in `samples` unchanged. */
export function summaryOf(samples: PerfSample[]): Summary | undefined {
	const last = samples.at(-1);
	if (last === undefined || last.frame === null) return undefined;
	let throughput = 0;
	let invokeP95 = 0;
	for (const stat of Object.values(last.invoke)) {
		throughput += stat.count;
		if (stat.p95 > invokeP95) invokeP95 = stat.p95;
	}
	return {
		frame: { ...last.frame },
		runtime: { ...last.runtime },
		events: { ...last.events },
		invokeThroughput: throughput,
		invokeP95,
	};
}

export function headline(summary: Summary): string {
	const frame = summary.frame;
	return (
		`fps=${frame.fps.toFixed(1)} p50=${frame.p50.toFixed(2)}ms ` +
		`p95=${frame.p95.toFixed(2)}ms long=${frame.longTasks} ` +
		`heap=${(summary.runtime.heapUsed / MB).toFixed(1)}MB`
	);
}
