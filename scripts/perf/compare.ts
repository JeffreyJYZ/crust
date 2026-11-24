/**
 * Compare two labelled runs. A load drift of more than 1.0 makes the pair
 * incomparable, so the command refuses rather than printing a fake win.
 */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { RunConditions } from "./conditions.ts";

/** A bare argument is a sample label; an explicit `.json` path stays a path. */
const pathOf = (arg: string): string =>
	arg.endsWith(".json")
		? resolve(arg)
		: resolve(import.meta.dir, "../../docs/reviews/perf", `${arg}.json`);

const LOAD_DRIFT_LIMIT = 1.0;

interface Level {
	name: string;
	fps: number;
	frameP50Ms: number | null;
	frameP95Ms: number | null;
	longTasks: number;
	longFrames: number;
}

interface Sample {
	label?: string;
	conditions?: RunConditions;
	levels: Level[];
}

const loadOf = (sample: Sample): { start: number; end: number } => {
	const c = sample.conditions;
	return { start: c?.start.load.one ?? Number.NaN, end: c?.end.load.one ?? Number.NaN };
};

const fixed = (value: number | null): string => (value === null ? "n/a" : value.toFixed(2));

export async function compare(leftArg: string, rightArg: string): Promise<number> {
	const leftPath = pathOf(leftArg);
	const rightPath = pathOf(rightArg);
	let left: Sample;
	let right: Sample;
	try {
		left = JSON.parse(await readFile(leftPath, "utf8")) as Sample;
		right = JSON.parse(await readFile(rightPath, "utf8")) as Sample;
	} catch (error) {
		console.log(`compare: FAIL cannot read a sample: ${String(error)}`);
		return 1;
	}
	const a = loadOf(left);
	const b = loadOf(right);
	if (![a.start, a.end, b.start, b.end].every(Number.isFinite)) {
		console.log("compare: REFUSE a sample has no recorded load; re-run with this harness");
		return 1;
	}
	const drift = Math.max(Math.abs(a.start - b.start), Math.abs(a.end - b.end));
	if (drift > LOAD_DRIFT_LIMIT) {
		console.log(
			`compare: REFUSE load drift ${drift.toFixed(2)} > ${LOAD_DRIFT_LIMIT.toFixed(1)} ` +
				`(${leftPath} start/end ${a.start}/${a.end}, ${rightPath} ${b.start}/${b.end})`,
		);
		return 1;
	}
	console.log(
		`compare: OK load drift ${drift.toFixed(2)}; ` +
			`contaminated ${left.conditions?.contaminated}/${right.conditions?.contaminated}`,
	);
	console.log(
		`load start/end a ${a.start.toFixed(2)}/${a.end.toFixed(2)} ` +
			`b ${b.start.toFixed(2)}/${b.end.toFixed(2)}`,
	);
	console.log(
		"level                          fps a     fps b     p50 a  p50 b  p95 a  p95 b  long a/b",
	);
	for (const [index, levelA] of left.levels.entries()) {
		const levelB = right.levels[index];
		if (levelB === undefined) continue;
		console.log(
			`${levelA.name.padEnd(30)} ${fixed(levelA.fps).padStart(8)} ` +
				`${fixed(levelB.fps).padStart(8)} ${fixed(levelA.frameP50Ms).padStart(7)} ` +
				`${fixed(levelB.frameP50Ms).padStart(6)} ${fixed(levelA.frameP95Ms).padStart(7)} ` +
				`${fixed(levelB.frameP95Ms).padStart(6)} ` +
				`${levelA.longTasks}/${levelB.longTasks}`,
		);
	}
	return 0;
}
