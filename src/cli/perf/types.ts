/** The on-disk shape of `crust perf record`. One file, one recorder, one diff reader. */

import type { PerfSample } from "@/perf";

export interface RecordMeta {
	app: string;
	seconds: number;
	/** False only in the recorder's private launch path; a shipped app keeps detection on. */
	occlusionDetectionEnabled: boolean;
	occlusionState: number;
	keepAwake: boolean;
	activation: "none";
	processesBefore: number;
	processesAfter: number;
	recordedAt: string;
}

export interface SummaryFrame {
	framesDrawn: number;
	fps: number;
	p50: number;
	p95: number;
	worst: number;
	longTasks: number;
	/** One-second windows with no new frames. Idle after a paint, not a fast or a slow app. */
	idleWindows: number;
}

export interface Summary {
	frame: SummaryFrame;
	runtime: { eventLoopDelayP95: number; heapUsed: number; heapTotal: number };
	events: { emitted: number; delivered: number; dropped: number; p95: number };
	/** Sum of every plugin's invoke count: the throughput number `diff` treats as higher-is-better. */
	invokeThroughput: number;
	invokeP95: number;
}

export interface PerfRecordFile {
	version: 1;
	meta: RecordMeta;
	summary: Summary;
	samples: PerfSample[];
}
