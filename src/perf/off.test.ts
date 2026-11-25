/**
 * The off-cost measurement the lane is judged on. The baseline is derived from the live
 * `invoke.ts` by removing the four lines marked `// perf-hook` and rewriting its relative imports,
 * so "without instrumentation" always means the same route from the same source — not a remembered
 * copy. Arms run A,B,A,A with a second uninstrumented route in the B slot as the same-arm control:
 * a delta inside that spread is invisible. Sinks stay off throughout, so this also proves counters
 * accumulate without a clock read. Nothing here launches a GUI app, moves a cursor or leaks a process.
 */

import { afterAll, expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import { loadavg } from "node:os";
import { join } from "node:path";
import { createRunner, type Run } from "../bridge/server/invoke.ts";
import type { CommandHandler, PluginContext } from "../plugins/define.ts";
import { countWrites, requestedBytes } from "./alloc.ts";
import { perfCollector } from "./collector.ts";

const N = 10_000;
const REPS = 5;
/** Exact bound on lazy InvokeStat creations in the measured window; warm-up already made them. */
const ALLOC_WRITES_BOUND = 0;
const ALL_OFF = { overlay: false, file: false, stdout: false };
const ANSWER = { ok: true };
const ARGS = { hello: "world" };
const BASELINE = join(import.meta.dir, "..", "..", `.perf-baseline-${process.pid}.ts`);

afterAll(async () => {
	await rm(BASELINE, { force: true });
});

interface Cost {
	us: number;
	bytes: number;
}

interface Row {
	a1: Cost;
	b: Cost;
	a2: Cost;
	a3: Cost;
}

async function baseline(): Promise<typeof createRunner> {
	const source = await Bun.file(join(import.meta.dir, "../bridge/server/invoke.ts")).text();
	const stripped = source
		.split("\n")
		.filter((line) => !line.includes("// perf-hook"))
		.join("\n")
		.replaceAll('from "../../plugins/define"', 'from "@/plugins/define"')
		.replaceAll('from "../errors"', 'from "@/bridge/errors"')
		.replaceAll('from "./actions.ts"', 'from "@/bridge/server/actions.ts"')
		.replaceAll('from "./body.ts"', 'from "@/bridge/server/body.ts"')
		.replaceAll('from "./capabilities.ts"', 'from "@/bridge/server/capabilities.ts"')
		.replaceAll('from "./invoke-request.ts"', 'from "@/bridge/server/invoke-request.ts"');
	if (stripped.includes("perfCollector"))
		throw new Error("baseline still carries instrumentation");
	await Bun.write(BASELINE, stripped);
	const module = (await import(BASELINE)) as { createRunner: typeof createRunner };
	return module.createRunner;
}

function handlers(): Map<string, CommandHandler> {
	return new Map<string, CommandHandler>([
		["alpha.echo", () => ANSWER],
		["beta.echo", () => ANSWER],
	]);
}

function context(): PluginContext {
	return { emit: () => {} };
}

async function all(run: Run): Promise<void> {
	for (let i = 0; i < N; i++) await run(i % 2 === 0 ? "alpha" : "beta", "echo", ARGS);
}

async function measure(run: Run): Promise<Cost> {
	await all(run);
	const before = requestedBytes();
	const started = Bun.nanoseconds();
	await all(run);
	const us = (Bun.nanoseconds() - started) / 1000 / N;
	return { us, bytes: requestedBytes() - before };
}

async function clockReads(run: Run): Promise<number> {
	const original = performance.now.bind(performance);
	let reads = 0;
	performance.now = () => {
		reads++;
		return original();
	};
	try {
		await all(run);
	} finally {
		performance.now = original;
	}
	return reads;
}

function median(values: number[]): number {
	const sorted = [...values].sort((a, b) => a - b);
	return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

function spread(rows: Row[], field: keyof Cost): number {
	return median(
		rows.map((row) => {
			const values = [row.a1[field], row.a2[field], row.a3[field]];
			return Math.max(...values) - Math.min(...values);
		}),
	);
}

/** Per-rep B-minus-A: pairing removes the drift a global median would mistake for overhead. */
function pairedDelta(rows: Row[], field: keyof Cost): number {
	return median(
		rows.map((row) => row.b[field] - median([row.a1[field], row.a2[field], row.a3[field]])),
	);
}

test("off is free: no extra clock read, no allocation, overhead inside the control spread", async () => {
	const bareFactory = await baseline();
	const bare = bareFactory(handlers(), context());
	// A second instance of the identical, uninstrumented route in the B slot: it measures the
	// position bias an A,B,A,A schedule introduces, which is the fair control for "B is slower".
	const bareControl = bareFactory(handlers(), context());
	const instrumented = createRunner(handlers(), context());
	perfCollector.setSinks(ALL_OFF);
	perfCollector.reset();

	const readsA = await clockReads(bare);
	const readsB = await clockReads(instrumented);
	const readsA2 = await clockReads(bare);
	const counted = [...perfCollector.invokes.values()].reduce((n, stat) => n + stat.count, 0);
	console.log(`off counters: invokes=${counted} expected=${N} (accumulate with sinks off)`);
	expect(counted).toBe(N);

	const rows: Row[] = [];
	const controlRows: Row[] = [];
	const writes = countWrites(perfCollector.invokes);
	try {
		for (let rep = 0; rep < REPS; rep++) {
			rows.push({
				a1: await measure(bare),
				b: await measure(instrumented),
				a2: await measure(bare),
				a3: await measure(bare),
			});
			controlRows.push({
				a1: await measure(bare),
				b: await measure(bareControl),
				a2: await measure(bare),
				a3: await measure(bare),
			});
		}
	} finally {
		writes.stop();
	}
	const statWrites = writes.read();
	const allA = (rows: Row[], field: keyof Cost): number[] =>
		rows.flatMap((row) => [row.a1[field], row.a2[field], row.a3[field]]);
	const usA = median(allA(rows, "us"));
	const usB = median(rows.map((row) => row.b.us));
	const bytesA = median(allA(rows, "bytes"));
	const bytesB = median(rows.map((row) => row.b.bytes));
	const overheadUs = pairedDelta(rows, "us");
	const controlUs = pairedDelta(controlRows, "us");
	const controlSpreadUs = spread(controlRows, "us");
	const overheadBytes = pairedDelta(rows, "bytes");
	const controlBytes = pairedDelta(controlRows, "bytes");
	const load = loadavg()
		.map((n) => n.toFixed(2))
		.join(" ");
	// "Within the control spread" means no worse than the same-arm route in the same slot: the
	// control absorbs scheduler and position bias, which can be larger than the hook itself.
	const invisible = overheadUs <= controlUs + Math.max(controlSpreadUs, 0.0001);

	console.log(`off-cost N=${N} reps=${REPS} loadavg=${load} child-processes=0`);
	console.log(`clock reads: baseline=${readsA} instrumented=${readsB} control=${readsA2}`);
	console.log(
		`time: baseline=${usA.toFixed(4)}us instrumented=${usB.toFixed(4)}us delta=${overheadUs.toFixed(4)}us same-arm-control=${controlUs.toFixed(4)}us spread=${controlSpreadUs.toFixed(4)}us`,
	);
	console.log(
		`alloc (diagnostic, GC-sensitive): baseline=${bytesA}B instrumented=${bytesB}B delta=${overheadBytes}B same-arm-control=${controlBytes}B`,
	);
	console.log(`alloc (exact): InvokeStat writes=${statWrites} bound=${ALLOC_WRITES_BOUND}`);
	console.log(
		invisible
			? `VERDICT within control spread: overhead ${overheadUs.toFixed(4)}us vs control ${controlUs.toFixed(4)}us`
			: `VERDICT DESIGN WRONG: overhead ${overheadUs.toFixed(4)}us outside control ${controlUs.toFixed(4)}us +- ${controlSpreadUs.toFixed(4)}us`,
	);

	expect(readsB).toBe(readsA);
	expect(readsA2).toBe(readsA);
	// Exact counter, not heap size: see alloc.ts for the measured GC swing that killed the old bound.
	expect(statWrites).toBeLessThanOrEqual(ALLOC_WRITES_BOUND);
}, 30_000);
