/** The sample shape and the sanity checks kept apart from the harness driver. */
import type { RunConditions } from "./conditions.ts";

export interface Occlusion {
	disabled: boolean;
	keepAwake: boolean;
	state: number;
	occluded: boolean | null;
}

export interface Distribution {
	n: number;
	p50: number | null;
	p95: number | null;
	max: number | null;
	min: number | null;
}

export interface InteractionRecord {
	label?: string;
	mode?: string;
	launchAnchors?: { readyAt: number | null; firstRafAt: number | null };
	launch?: { readyMs: number | null; firstFrameMs: number | null };
	captureControl?: Distribution;
	arms?: Record<string, Record<string, unknown>>;
	error?: string;
	final?: boolean;
	conditions?: RunConditions;
	occlusionDetection?: boolean;
	occlusion?: Occlusion;
	processStartMs?: number;
	debugMarks?: number;
	debugStarts?: number;
}

/** The same p50/p95/max shape the page reports, computed in the harness. */
export function distribution(values: number[]): Distribution {
	if (values.length === 0) return { n: 0, p50: null, p95: null, max: null, min: null };
	const sorted = [...values].sort((a, b) => a - b);
	return {
		n: values.length,
		p50: sorted[Math.ceil(0.5 * sorted.length) - 1] ?? null,
		p95: sorted[Math.ceil(0.95 * sorted.length) - 1] ?? null,
		max: sorted.at(-1) ?? null,
		min: sorted[0] ?? null,
	};
}

/** Hard failures only: a sample that drew nothing is never reported as a number. */
export function verify(record: InteractionRecord, mode: string): string[] {
	const bad: string[] = [];
	if (record.error) bad.push(`page error: ${record.error.slice(0, 120)}`);
	if (record.occlusion?.disabled !== true) bad.push("occlusion override missing");
	if (mode === "core") {
		const arms = record.arms ?? {};
		const key = arms.keystroke as { painted?: Distribution } | undefined;
		const click = arms.click as { synthetic?: Distribution } | undefined;
		if ((key?.painted?.n ?? 0) < 30) bad.push(`keystroke only ${key?.painted?.n ?? 0}/30`);
		if ((click?.synthetic?.n ?? 0) < 50) bad.push(`click only ${click?.synthetic?.n ?? 0}/50`);
	}
	if (mode === "paint") {
		const arms = record.arms ?? {};
		const scroll = arms.scroll as { painted?: boolean; durationMs?: number } | undefined;
		const resize = arms.resize as { steps?: number } | undefined;
		if ((scroll?.durationMs ?? 0) < 2500) bad.push("scroll duration short");
		if ((resize?.steps ?? 0) < 20) bad.push("resize steps missing");
	}
	if (mode === "windows") {
		const win = (record.arms ?? {}).windowOpen as
			{ ready?: Distribution; firstRaf?: Distribution; createAck?: Distribution } | undefined;
		if ((win?.createAck?.n ?? 0) < 10) bad.push("create acknowledgements missing");
	}
	if (mode === "launch" && !Number.isFinite(record.launch?.readyMs)) bad.push("no launch anchor");
	return bad;
}

/** Attach the conditions every perf sample in this repo must carry. */
export function decorate(
	record: InteractionRecord,
	label: string,
	mode: string,
	start: unknown,
	end: unknown,
	runConditions: (start: never, end: never) => RunConditions,
	occlusion: Occlusion,
): void {
	Object.assign(record, {
		label,
		mode,
		processStartMs: record.processStartMs,
		conditions: runConditions(start as never, end as never),
		occlusionDetection: !occlusion.disabled,
		occlusion,
	});
}
