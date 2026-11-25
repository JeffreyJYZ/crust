/**
 * `crust perf record`: one WebKit window, one frame sampler, one sample per second. A run that drew
 * no frames is a failure with a reason — never a JSON file that reads as a fast or slow app.
 */

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { Collector } from "@/perf";
import { buildSample, type PerfSample } from "@/perf/sample.ts";
import { appRoot } from "./app-root.ts";
import { headline, summaryOf } from "./format.ts";
import { launchApp, waitForPage, type LaunchedApp } from "./launch.ts";
import { processGate, recorderSnapshot } from "./processes.ts";
import type { PerfRecordFile } from "./types.ts";

export interface RecordArgs {
	app: string;
	seconds: number;
	out: string;
	format: "json" | "text";
}

const sleep = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));

async function pageSamplerSource(): Promise<string> {
	const dir = mkdtempSync(join(tmpdir(), "crust-perf-sampler-"));
	try {
		const result = await Bun.build({
			entrypoints: [resolve(import.meta.dir, "page-sampler.ts")],
			outdir: dir,
			target: "browser",
			format: "iife",
		});
		if (!result.success)
			throw new Error(`page sampler build failed: ${result.logs.join("\n")}`);
		const output = result.outputs[0];
		if (output === undefined) throw new Error("page sampler build emitted nothing");
		// The native evaluate channel has no answer for `undefined`; return a string.
		return `${readFileSync(output.path, "utf8")}\n"crust-perf-sampler-ready";`;
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

const STALLED =
	"renderer never drew a frame (occluded or suspended WebView); no sample written — " +
	"a stalled run must not read as fast or slow";

/**
 * The one failure this recorder owns: the renderer never painted in the whole run. A page that
 * painted and then went idle is a valid measurement — `frame.idleWindows` in the file says so,
 * and `fps === 0` after a paint must not be read as fast or as stalled.
 */
export type RecordVerdict = { ok: true } | { ok: false; reason: string };

export function verdict(samples: PerfSample[]): RecordVerdict {
	const painted = samples.some((sample) => sample.frame !== null && sample.frame.framesDrawn > 0);
	return painted ? { ok: true } : { ok: false, reason: STALLED };
}

async function waitForFirstFrame(collector: Collector, timeoutMs = 3000): Promise<boolean> {
	const deadline = performance.now() + timeoutMs;
	while (performance.now() < deadline) {
		const frame = collector.frame;
		if (frame !== null && frame.framesDrawn > 0) return true;
		await sleep(100);
	}
	return false;
}

function fail(message: string): number {
	console.error(`crust perf record: ${message}`);
	return 2;
}

/**
 * Every failure after the output path is known goes through here. A failed re-record must not leave
 * the previous run's file on disk for `perf diff` to read as this run's result.
 */
export async function failRecord(out: string, message: string, code = 2): Promise<number> {
	await rm(out, { force: true });
	return fail(message);
}

export async function record(args: RecordArgs): Promise<number> {
	const root = await appRoot(args.app);
	if (root === undefined)
		return fail(`not an app: ${args.app} — no index.html or public/index.html`);
	if (!Number.isFinite(args.seconds) || args.seconds < 1)
		return fail("--seconds needs a positive number");
	const seconds = Math.min(Math.floor(args.seconds), 10);
	const out = resolve(args.out);
	const before = await recorderSnapshot();
	const collector = new Collector();
	let app: LaunchedApp | undefined;
	let samples: PerfSample[] = [];
	let meta: PerfRecordFile["meta"] | undefined;
	let keepAlive: ReturnType<typeof setInterval> | undefined;

	try {
		app = await launchApp(root, collector, `crust-perf-record-${process.pid}`);
		if (!(await waitForPage(app)))
			throw new Error("page never exposed window.crust.perf.frameReport");
		await app.evaluate(await pageSamplerSource());
		if (!(await waitForFirstFrame(collector))) throw new Error(STALLED);
		// WebKit re-occludes an unfocused window on any app switch; keep the private selector live
		// for the whole run rather than only at launch.
		keepAlive = setInterval(() => app?.reassert(), 100);
		const occlusionStates: number[] = [];
		for (let index = 0; index < seconds; index++) {
			await sleep(1000);
			occlusionStates.push(app.occlusionNow());
			app.reassert();
			samples.push(buildSample(collector, Date.now()));
		}
		const occluded = occlusionStates.map((state) => (state & 2) === 0);
		const occludedWindows = occluded.flatMap((value, index) => (value ? [index] : []));
		const occlusionTransitions = occluded.filter(
			(value, index) => index > 0 && value !== occluded[index - 1],
		).length;
		meta = {
			app: root,
			seconds,
			occlusionDetectionEnabled: app.occlusionDetectionEnabled,
			occlusionStates,
			occludedWindows,
			occlusionTransitions,
			occlusionState: app.occlusionState,
			keepAwake: app.keepAwake,
			activation: "none",
			processesBefore: before.conditions.bunProcesses,
			processesAfter: 0,
			recordedAt: new Date().toISOString(),
		};
	} catch (error) {
		return await failRecord(out, error instanceof Error ? error.message : String(error));
	} finally {
		if (keepAlive !== undefined) clearInterval(keepAlive);
		await app?.stop();
	}

	const after = await recorderSnapshot();
	const gate = processGate(before, after);
	console.error(gate.text);
	const summary = summaryOf(samples, meta?.occludedWindows ?? []);
	if (meta === undefined || summary === undefined) {
		return await failRecord(out, "no page frame report was collected; no sample written");
	}
	if (!gate.ok) {
		return await failRecord(
			out,
			"fail — an app process outlived the run; no sample written",
			1,
		);
	}
	const decision = verdict(samples);
	if (!decision.ok) return await failRecord(out, decision.reason);

	meta.processesAfter = after.conditions.bunProcesses;
	const file: PerfRecordFile = { version: 1, meta, summary, samples };
	await mkdir(dirname(out), { recursive: true });
	await writeFile(out, `${JSON.stringify(file, null, 2)}\n`, "utf8");
	if (args.format === "json") console.log(JSON.stringify({ ...summary, meta, out }));
	else console.log(headline(summary));
	return 0;
}
