/**
 * `crust perf diff`: direction belongs to the field, not to the command. Frame time and p95 want
 * less; fps, delivery and invoke throughput want more. A blanket "after > before is bad" would call
 * a faster app a regression.
 */

import { readFile } from "node:fs/promises";
import type { PerfRecordFile, Summary } from "./types.ts";

type Direction = "lower" | "higher";

interface Metric {
	field: string;
	before: number;
	after: number;
	better: Direction;
}

export interface DiffResult {
	lines: string[];
	regressions: string[];
}

function fieldOf(record: PerfRecordFile): Summary | undefined {
	if (record.summary?.frame !== undefined) return record.summary;
	const last = record.samples?.at(-1);
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

function metrics(before: Summary, after: Summary): Metric[] {
	const fields: Array<[string, keyof Summary["frame"] | string, Direction]> = [
		["frame.fps", "fps", "higher"],
		["frame.p50", "p50", "lower"],
		["frame.p95", "p95", "lower"],
		["frame.worst", "worst", "lower"],
		["frame.longTasks", "longTasks", "lower"],
		["frame.framesDrawn", "framesDrawn", "higher"],
	];
	const rows: Metric[] = fields.map(([field, key, better]) => ({
		field,
		before: Number(before.frame[key as keyof Summary["frame"]] ?? 0),
		after: Number(after.frame[key as keyof Summary["frame"]] ?? 0),
		better,
	}));
	const groups: Array<[string, Direction, (summary: Summary) => number]> = [
		["runtime.eventLoopDelayP95", "lower", (s) => s.runtime.eventLoopDelayP95],
		["runtime.heapUsed", "lower", (s) => s.runtime.heapUsed],
		["events.emitted", "higher", (s) => s.events.emitted],
		["events.delivered", "higher", (s) => s.events.delivered],
		["events.dropped", "lower", (s) => s.events.dropped],
		["invoke.throughput", "higher", (s) => s.invokeThroughput],
		["invoke.p95", "lower", (s) => s.invokeP95],
	];
	for (const [field, better, read] of groups) {
		rows.push({ field, before: read(before), after: read(after), better });
	}
	return rows;
}

/** Percent change, with zero handled as a threshold rather than a division by zero. */
function delta(before: number, after: number, better: Direction, tolerance: number) {
	if (before === 0 && after === 0) return { pct: 0, bad: false, text: "+0.0%" };
	if (before === 0) {
		const bad = better === "lower" && after > 0;
		return { pct: bad ? Infinity : -Infinity, bad, text: after > 0 ? "+inf" : "-inf" };
	}
	const pct = ((after - before) / Math.abs(before)) * 100;
	const bad = better === "lower" ? pct > tolerance : pct < -tolerance;
	return { pct, bad, text: `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%` };
}

export function diffRecords(
	beforeFile: PerfRecordFile,
	afterFile: PerfRecordFile,
	tolerance: number,
): DiffResult | string {
	const before = fieldOf(beforeFile);
	const after = fieldOf(afterFile);
	if (before === undefined || after === undefined) {
		return "a sample has no frame block — only a completed record can be diffed";
	}
	const lines = ["field                      before       after    delta  rule"];
	const regressions: string[] = [];
	for (const row of metrics(before, after)) {
		const change = delta(row.before, row.after, row.better, tolerance);
		const rule = row.better === "lower" ? "lower is better" : "higher is better";
		lines.push(
			`${row.field.padEnd(26)}${row.before.toFixed(2).padStart(10)}` +
				`${row.after.toFixed(2).padStart(12)}  ${change.text.padStart(8)}  ` +
				`${rule}${change.bad ? "  REGRESS" : ""}`,
		);
		if (change.bad) {
			regressions.push(
				`regression: ${row.field} ${row.before.toFixed(2)} -> ${row.after.toFixed(2)} ` +
					`(${change.text}, tolerance ${tolerance}%, ${rule})`,
			);
		}
	}
	return { lines, regressions };
}

async function load(path: string): Promise<PerfRecordFile> {
	return JSON.parse(await readFile(path, "utf8")) as PerfRecordFile;
}

export async function diffFiles(
	beforePath: string,
	afterPath: string,
	tolerance: number,
): Promise<number> {
	if (!Number.isFinite(tolerance) || tolerance < 0) {
		console.log(`crust perf diff: --tolerance needs a non-negative number, got ${tolerance}`);
		return 1;
	}
	let before: PerfRecordFile;
	let after: PerfRecordFile;
	try {
		[before, after] = await Promise.all([load(beforePath), load(afterPath)]);
	} catch (error) {
		console.log(`crust perf diff: cannot read a sample: ${String(error)}`);
		return 1;
	}
	const result = diffRecords(before, after, tolerance);
	if (typeof result === "string") {
		console.log(`crust perf diff: ${result}`);
		return 1;
	}
	for (const line of result.lines) console.log(line);
	for (const line of result.regressions) console.log(line);
	return result.regressions.length === 0 ? 0 : 1;
}
