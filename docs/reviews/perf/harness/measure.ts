/**
 * CLI for the headless perf scaffold. `measure` records one labelled sample
 * through the in-process crust bridge + private occlusion scaffolding; `compare`
 * refuses a pair whose recorded load drift is over 1.0.
 */
import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { cac } from "cac";
import { compare } from "./compare.ts";
import { runInProcess } from "./in-process.ts";
import type { RunConditions } from "./conditions.ts";

const root = resolve(import.meta.dir, "../..");

const cli = cac("perf");
cli.usage("<command> [options]");
cli.command("measure", "record one labelled perf sample").option(
	"--label <name>",
	"sample name (default: baseline)",
);
cli.command("compare <left> <right>", "diff two labelled samples with a load guard");

interface Sample {
	label: string;
	conditions: RunConditions;
	occlusion: { disabled: boolean; keepAwake: boolean; state: number; occluded: boolean | null };
	levels: Array<{
		name: string;
		fps: number;
		frames: number;
		frameP50Ms: number | null;
		frameP95Ms: number | null;
		longTasks: number;
		longFrames: number;
	}>;
}

const exists = (path: string): Promise<boolean> =>
	stat(path).then(
		() => true,
		() => false,
	);

function printSummary(sample: Sample): void {
	const c = sample.conditions;
	console.log(
		`perf ${sample.label}: contaminated=${c.contaminated} ` +
			`load ${c.start.load.one.toFixed(2)} -> ${c.end.load.one.toFixed(2)} ` +
			`bun ${c.start.bunProcesses} -> ${c.end.bunProcesses} ` +
			`probe pids ${c.start.probePids.length} -> ${c.end.probePids.length} ` +
			`occlusion disabled=${sample.occlusion.disabled} occluded=${sample.occlusion.occluded}`,
	);
	for (const level of sample.levels) {
		console.log(
			`  ${level.name.padEnd(30)} fps ${level.fps.toFixed(1)} ` +
				`p50 ${level.frameP50Ms?.toFixed(2) ?? "n/a"} ` +
				`p95 ${level.frameP95Ms?.toFixed(2) ?? "n/a"} ` +
				`frames ${level.frames} longTasks ${level.longTasks} longFrames ${level.longFrames}`,
		);
	}
}

async function measure(rawLabel: string | undefined): Promise<number> {
	const label = rawLabel ?? "baseline";
	if (!/^[a-zA-Z0-9][a-zA-Z0-9-]*$/.test(label)) {
		console.log(`perf: FAIL bad label ${label}`);
		return 1;
	}
	const out = resolve(root, "docs/reviews/perf", `${label}.json`);
	if (await exists(out)) {
		console.log(`perf: FAIL ${out} exists; choose another --label`);
		return 1;
	}
	const code = await runInProcess(label, root, out);
	if (code !== 0) return code;
	const sample = JSON.parse(await readFile(out, "utf8")) as Sample;
	printSummary(sample);
	const leaked = sample.conditions.end.probePids.filter(
		(pid) => !sample.conditions.start.probePids.includes(pid),
	);
	const fail =
		leaked.length > 0 ||
		sample.conditions.end.probePids.length > sample.conditions.start.probePids.length;
	console.log(
		`perf processes: start=${sample.conditions.start.probePids.length} ` +
			`end=${sample.conditions.end.probePids.length} new=${leaked.length} ` +
			`${fail ? "FAIL" : "PASS"}`,
	);
	return fail ? 1 : 0;
}

const parsed = cli.parse(["bun", "perf", ...process.argv.slice(2)], { run: false });
const command = cli.matchedCommandName ?? parsed.args[0];
if (command !== "measure" && command !== "compare") {
	cli.outputHelp();
	process.exitCode = 1;
} else {
	// cac keeps the command but drops named positionals with `run: false`.
	const args = process.argv.slice(3);
	process.exitCode =
		command === "measure"
			? await measure(parsed.options.label as string | undefined)
			: await compare(args[0] ?? "", args[1] ?? "");
}
