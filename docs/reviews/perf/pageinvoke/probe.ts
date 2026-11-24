#!/usr/bin/env bun
/**
 * Lane H: split lane A's loaded arm into invokes-only, events-only, and both.
 * In-process: real bridge, real window, page-owned rAF deltas. The private WebKit occlusion
 * selector is DEV-ONLY scaffolding (see scripts/perf/perf-native.c); never a shipped default.
 * One round per process, ~7 s, so a transport death costs at most one JSONL line.
 */
import { appendFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { windowUrl } from "../../../../src/app-windows.ts";
import { setTestingActivation } from "../../../../src/plugins/activation-policy.ts";
import { startBridge, type BridgeHandle } from "../../../../src/bridge/server.ts";
import { definePlugin, type PluginContext } from "../../../../src/plugins/define.ts";
import { createWindowPlugin } from "../../../../src/plugins/window.ts";
import { darwinWindowAdapter } from "../../../../src/platform/darwin/window-adapter.ts";
import { DarwinPlatform } from "../../../../src/platform/darwin/platform.ts";
import { darwinTestingAdapter } from "../../../../src/plugins/testing-darwin.ts";
import { createPerfPlugin } from "../../../../src/plugins/perf.ts";
import { runConditions, snapshot, type Conditions } from "../../../../scripts/perf/conditions.ts";
import { perfNative } from "../../../../scripts/perf/perf-native.ts";

const ARM_MS = 700;
const ROUND = Number(process.argv[2] ?? "0");
const OUT = resolve(import.meta.dir, `round-${ROUND}.jsonl`);

const ARMS = [
	{ name: "idle", hz: 0, ev: 0 },
	{ name: "invoke-30", hz: 30, ev: 0 },
	{ name: "events-30", hz: 0, ev: 30 },
	{ name: "idle-self", hz: 0, ev: 0 },
	{ name: "invoke-200", hz: 200, ev: 0 },
	{ name: "events-120", hz: 0, ev: 120 },
	{ name: "both-A", hz: 90, ev: 30 },
	{ name: "laneA-paced", hz: 0, ev: 0, manual: 90, paced: true },
	{ name: "idle", hz: 0, ev: 0 },
	{ name: "idle-self", hz: 0, ev: 0 },
] as const;

const sleep = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));
const oneMinuteLoad = (c: Conditions): number => c.load.one;

async function main(): Promise<number> {
	if (process.platform !== "darwin") return 1;
	const before = await snapshot();
	await writeFile(OUT, "", "utf8");
	setTestingActivation("none");
	const native = perfNative();
	let ticks = 0;
	let events = 0;
	let emitter: ReturnType<typeof setInterval> | undefined;
	const platform = new DarwinPlatform({ appName: "crust-pageinvoke-probe", activate: "never" });
	const pagei = definePlugin({
		name: "pagei",
		commands: {
			ping: () => ({ n: ++ticks }),
			pace: async ({ ms }: { ms?: number }) => {
				await Bun.sleep(Math.min(100, Math.max(1, ms ?? 16)));
				return { n: ++ticks };
			},
			payload: ({ kind }: { kind?: string }) => {
				if (kind === "small") return { ok: true, value: true };
				if (kind === "medium") return { items: Array.from({ length: 200 }, (_, i) => ({ name: `field-${i}`, value: "x".repeat(16) })) };
				return new Uint8Array(1024 * 1024);
			},
			stream: ({ hz }: { hz?: number }, ctx: PluginContext) => {
				if (emitter !== undefined) clearInterval(emitter);
				emitter = setInterval(() => { events++; ctx.emit("pagei:tick", { n: events }); }, Math.round(1000 / (hz ?? 30)));
				return { started: true, hz: hz ?? 30 };
			},
			stop: () => {
				if (emitter !== undefined) clearInterval(emitter);
				emitter = undefined;
				return { stopped: true, events };
			},
			quit: () => ({ quitting: true }),
		},
	});
	const perf = createPerfPlugin();
	const emit: (event: string, payload: unknown) => void = (event, payload) => bridge.emit(event, payload);
	const bridge: BridgeHandle = startBridge({
		handlers: [pagei, perf, createWindowPlugin(darwinWindowAdapter(platform))],
		root: resolve(import.meta.dir, "public"),
	});
	let opened = false;
	const cleanup = (): void => {
		try { if (opened) platform.destroy("main"); platform.stopPump(); } catch { /* already gone */ }
	};
	process.on("exit", cleanup);
	for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
		process.on(signal, () => { cleanup(); process.kill(process.pid, signal); });
	}
	try {
		await platform.start();
		platform.pump(16);
		const url = windowUrl({ label: "main", url: "/" }, undefined, bridge);
		platform.createWindow({ label: "main", url, width: 720, height: 520, title: "page invoke probe", activate: false });
		opened = true;
		const web = platform.webview("main");
		const win = platform.nativeWindow("main");
		if (web === undefined || win === undefined) throw new Error("probe window has no webview");
		// Apply BEFORE the first evaluate: WebKit caches occlusion at first visibility.
		const { S } = await import("../../../../src/platform/darwin/objc.ts");
		S.vq1(win, "setCollectionBehavior:", 1);
		if (native.perf_occlusion(web, 0) !== 1) throw new Error("private occlusion selector absent: rAF suspended");
		native.perf_keep_awake();
		const testing = darwinTestingAdapter((label) => {
			if (label !== undefined && label !== "main") throw new Error("no window " + label);
			return web;
		});
		// Navigation is async and `testing.query` is unreliable for this page; the page's own ready
		// flag is the load gate. A failure here is a failed measurement, never zero frames.
		let pageReady = false;
		await sleep(1200);
		for (let i = 0; i < 40; i++) {
			await sleep(100);
			const answer = String(await testing.evaluate("main", "JSON.stringify(!!(window.__bench && window.__bench.ready()))"));
			if (answer === "true") {
				pageReady = true;
				break;
			}
		}
		if (!pageReady) throw new Error("page never loaded");
		await testing.evaluate("main", "window.__bench.listenEvents()");
		const micro = JSON.parse(String(await testing.evaluate("main", "window.__bench.micro(20)")));
		await appendFile(OUT, JSON.stringify({ round: ROUND, arm: "micro", micro }) + "\n", "utf8");
		for (const kind of ["small", "medium", "binary"]) {
			await testing.evaluate("main", `window.__bench.payload("${kind}",10)`);
			let payload: unknown = null;
			for (let i = 0; i < 80; i++) {
				const answer = JSON.parse(String(await testing.evaluate("main", "window.__bench.payloadResult()")));
				if (answer.done) { payload = answer.roundTrip; break; }
				await sleep(50);
			}
			await appendFile(OUT, JSON.stringify({ round: ROUND, arm: `payload-${kind}`, roundTrip: payload }) + "\n", "utf8");
		}

		for (const arm of ARMS) {
			await testing.evaluate("main", "window.__bench.start()");
			if (arm.hz) await testing.evaluate("main", `window.__bench.invoke(${arm.hz})`);
			if ("manual" in arm) await testing.evaluate("main", `window.__bench.manual(${arm.manual},${"paced" in arm && arm.paced})`);
			if (arm.ev) await pagei.commands.stream({ hz: arm.ev }, { emit } as PluginContext);
			const start = await snapshot();
			await sleep(ARM_MS);
			const end = await snapshot();
			await pagei.commands.stop();
			const raw = String(await testing.evaluate("main", "window.__bench.stop()"));
			const page = JSON.parse(raw) as Record<string, unknown>;
			const samplePerf = perf.commands.sample();
			const row = {
				round: ROUND,
				arm: arm.name,
				armMs: ARM_MS,
				fps: Number(page.frames) / (ARM_MS / 1000),
				page,
				perf: samplePerf,
				conditions: runConditions(start, end),
			};
			if (Number(page.frames) === 0 || page.visibility !== "visible") {
				throw new Error(`sanity: arm=${arm.name} frames=${page.frames} visibility=${page.visibility}`);
			}
			await appendFile(OUT, JSON.stringify(row) + "\n", "utf8");
			console.log(`SAMPLE arm=${arm.name} round=${ROUND} fps=${Number(row.fps.toFixed(2))} frames=${page.frames} inv=${Number(page.invokes)} load=${oneMinuteLoad(start).toFixed(2)}`);
		}
		await pagei.commands.quit();
	} finally {
		cleanup();
		process.removeListener("exit", cleanup);
		await bridge.stop();
	}
	const after = await snapshot();
	console.log(`LEAK bun ${before.bunProcesses} -> ${after.bunProcesses}; contaminated=${ARMS.length > 0 && oneMinuteLoad(after) > 2}`);
	return 0;
}

let code = 1;
try { code = await main(); }
catch (error) { console.log("FAIL", error instanceof Error ? error.message : String(error)); }
process.exit(code);
