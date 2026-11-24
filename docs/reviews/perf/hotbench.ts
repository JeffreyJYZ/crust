import { heapStats } from "bun:jsc";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createPump } from "@/platform/darwin/pump.ts";
import { Events, sseFrame } from "@/bridge/server/events.ts";
import { createRunner } from "@/bridge/server/invoke.ts";
import { invokeRequest } from "@/bridge/server/invoke-request.ts";
import { createHandler } from "@/bridge/server/handler.ts";
import { compileCapabilities, type CompiledCapabilities } from "@/bridge/server/capabilities.ts";
import { candidateActions, effectiveAction } from "@/bridge/server/actions.ts";
import { byteLengthOf } from "@/bridge/server/body.ts";
import { encodeResult } from "@/bridge/server/bytes.ts";
import { PluginRegistry } from "@/plugins/registry.ts";
import { installCrust } from "@/bridge/client/install.ts";
import { installInvoke } from "@/bridge/client/invoke.ts";
import { createFrameMemory } from "@/plugins/window-frame-memory.ts";
import { watchWindows, watchLifecycle } from "@/app-watch.ts";
import { invokeRecord, appRecord } from "@/logging/records.ts";
import { buildRecord, serializeRecord } from "@/logging/record.ts";
import { redactText, redactFields } from "@/logging/redact.ts";
import { configureLogger, logEvent, resetLogger, flushLogger, writeRecord, setLoggerLevel } from "@/logging/logger.ts";
import { createSink } from "@/logging/sink.ts";
import { rotateChain } from "@/logging/rotate.ts";

const sinkKeep: unknown[] = [];
const med = (a: number[]) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)]!;
const sys = (argv: string[]) => Bun.spawnSync(argv).stdout.toString().trim();
const load = () => sys(["sysctl", "-n", "vm.loadavg"]).split(" ")[1] ?? "?";
const bunCount = () => sys(["ps", "-Ao", "command"]).split("\n").filter((l) => /(^|\/)bun(\s|$)/.test(l)).length;

async function bench(label: string, fn: (i: number) => unknown | Promise<unknown>, n: number, isAsync = false) {
	for (let i = 0; i < Math.min(n, 200); i++) await fn(i);
	const l0 = load(), p0 = bunCount();
	const us: number[] = [], bytes: number[] = [];
	for (let rep = 0; rep < 5; rep++) {
		const out = new Array(n);
		const m0 = heapStats().mimalloc.malloc_requested;
		const t0 = performance.now();
		if (isAsync) for (let i = 0; i < n; i++) out[i] = await fn(i);
		else for (let i = 0; i < n; i++) out[i] = fn(i);
		const t1 = performance.now();
		const m1 = heapStats().mimalloc.malloc_requested;
		us.push(((t1 - t0) * 1000) / n);
		bytes.push((m1 - m0) / n);
		sinkKeep.push(out);
	}
	console.log(`ROW ${label} | ${med(us).toFixed(3)} us/op | ${med(bytes).toFixed(1)} malloc-B/op | n=${n} reps=5 | load=${l0}->${load()} bun=${p0}->${bunCount()}`);
}

async function pair(label: string, fnA: (i: number) => unknown | Promise<unknown>, fnB: (i: number) => unknown | Promise<unknown>, n: number, setupA: () => void, setupB: () => void, setupC: () => void) {
	setupA(); for (let i = 0; i < Math.min(n, 100); i++) await fnA(i);
	setupB(); for (let i = 0; i < Math.min(n, 100); i++) await fnB(i);
	const l0 = load(), p0 = bunCount();
	const a: number[] = [], b: number[] = [], c1: number[] = [], c2: number[] = [];
	const aa: number[] = [], bb: number[] = [], ca: number[] = [], cb: number[] = [];
	for (let rep = 0; rep < 5; rep++) {
		const once = async (fn: (i: number) => unknown | Promise<unknown>, times: number[], alloc: number[]) => {
			const out = new Array(n), m0 = heapStats().mimalloc.malloc_requested, t0 = performance.now();
			for (let i = 0; i < n; i++) out[i] = await fn(i);
			times.push(((performance.now() - t0) * 1000) / n);
			alloc.push((heapStats().mimalloc.malloc_requested - m0) / n);
			sinkKeep.push(out);
		};
		setupA(); await once(fnA, a, aa);
		setupB(); await once(fnB, b, bb);
		setupC(); await once(fnA, c1, ca);
		setupC(); await once(fnA, c2, cb);
	}
	console.log(`PAIR ${label} | A=${med(a).toFixed(3)} B=${med(b).toFixed(3)} control=${med(c1).toFixed(3)}/${med(c2).toFixed(3)} spread=${Math.abs(med(c1) - med(c2)).toFixed(3)} us/op | alloc A=${med(aa).toFixed(1)} B=${med(bb).toFixed(1)} C=${med(ca).toFixed(1)}/${med(cb).toFixed(1)} B/op | load=${l0}->${load()} bun=${p0}->${bunCount()}`);
}

const tmp = mkdtempSync(join(tmpdir(), "crust-hot-"));
const input = { ok: true, value: 42, name: "probe" };
const body = JSON.stringify({ plugin: "probe", command: "noop", args: input, window: "main" });
const reply = JSON.stringify({ ok: true, result: input });

// ---- page client ---------------------------------------------------------
await bench("client/JSON.stringify body", () => JSON.stringify({ plugin: "probe", command: "noop", args: input, window: "main" }), 20000);
await bench("client/JSON.parse response", () => JSON.parse(reply), 20000);
await bench("page/event sseFrame", () => sseFrame("app:event", { event: "x", at: 1 }), 20000);
{
	const scope: Record<string, any> = { document: { addEventListener() {}, dispatchEvent() {} }, CustomEvent: class {}, fetch: async () => new Response(reply, { status: 200 }), EventSource: class { addEventListener() {} } };
	let onEvent: ((e: string, p: unknown) => void) | undefined;
	const invokeFactory = (...args: any[]) => {
		const half = installInvoke(...args as never) as any;
		return { ...half, connect() {}, attach() {} } as any;
	};
	const api = installCrust({ url: "http://x", token: "t" }, scope, invokeFactory as never, undefined as never);
	for (let i = 0; i < 3; i++) api.listen("app:event", () => {});
	// Capture the onEvent hook by reinstalling with a factory that forwards it.
	const captured: any[] = [];
	const scope2: Record<string, any> = { document: { addEventListener() {}, dispatchEvent() {} }, fetch: async () => {}, EventSource: class { addEventListener() {} } };
	installCrust({ url: "http://x", token: "t" }, scope2, ((s: any, base: any, token: any, label: any, onAnswer: any, onEvent: any) => { captured.push(onEvent); return { attach() {}, connect() {} }; }) as never, undefined as never);
	const emit = captured[0]!;
	await bench("page/event dispatch (3 listeners)", () => emit("app:event", JSON.stringify({ event: "x", at: 1 })), 20000);
}
{
	const scope: Record<string, any> = { fetch: async () => new Response(reply, { status: 200 }), EventSource: class {} };
	const call = installInvoke(scope, "http://x", "t", "main", () => {}, () => {});
	await bench("client/invoke full (stub fetch)", () => call("probe", "noop", input), 2000, true);
}

// ---- server side ---------------------------------------------------------
await bench("server/byteLengthOf result", () => byteLengthOf(input), 20000);
await bench("server/encodeResult", () => encodeResult(input), 20000);
await bench("server/effectiveAction+candidateActions", () => candidateActions("app", "invoke", { name: "notes.save" }), 20000);
const openCaps = compileCapabilities(undefined);
const gatedCaps = compileCapabilities({ capabilities: [{ name: "n", actions: ["probe:*", "core:*", "app:*"] }], grants: { main: ["n"] } } as never);
await bench("server/capability allows (open)", () => openCaps.allows("main", "probe:noop"), 20000);
await bench("server/capability allows (compiled)", () => gatedCaps.allows("main", "probe:noop"), 20000);
const handlers = new Map<string, any>([["probe.noop", async () => input]]);
await bench("server/handler lookup", () => handlers.get("probe.noop"), 20000);
const ctxPlain = { emit() {} } as Record<string, unknown>;
await bench("server/context spread (routing hint)", () => ({ ...ctxPlain, window: "main" }), 20000);
const { corsHeaders } = await import("@/bridge/server/cors.ts");
await bench("server/new URL + corsHeaders", () => [new URL("http://127.0.0.1:1234/_crust/invoke"), corsHeaders(null, [])], 20000);
const registry = new PluginRegistry();
registry.register({ name: "probe", commands: { noop: async () => input } } as never);
await bench("registry/invoke (async stub)", async () => registry.invoke("probe", "noop", input, {} as never), 3000, true);

// Logging configured to a scratch root; request path uses logEvent (sync, fire-and-forget).
configureLogger({ root: tmp, appId: "hotbench", level: "debug", console: false });
const record = invokeRecord({ window: "main", ns: "probe", cmd: "noop", durMs: 0.123, ok: true, bytesIn: 88, bytesOut: 32 });
await bench("log/invokeRecord builder", () => invokeRecord({ window: "main", ns: "probe", cmd: "noop", durMs: 0.123, ok: true, bytesIn: 88, bytesOut: 32 }), 20000);
await bench("log/redactText msg", () => redactText("probe.noop ok in 0.12 ms"), 20000);
await bench("log/redactFields", () => redactFields(record.fields), 20000);
await bench("log/buildRecord", () => buildRecord(record, 1, 1, 1), 20000);
await bench("log/serializeRecord", () => serializeRecord(record), 20000);
await bench("log/logEvent (level debug, sync part)", () => logEvent(record), 2000);
await flushLogger();
await bench("log/writeRecord (awaited)", async () => writeRecord(record), 200, true);
const sink = createSink({ file: join(tmp, "sink.jsonl"), errorsFile: join(tmp, "sink-errors.jsonl") });
const built = buildRecord(record, Date.now(), process.pid, 1);
await bench("log/sink.write (stat+mkdir+append, awaited)", async () => sink.write(built), 200, true);
await bench("log/rotateChain (forced)", async (i) => rotateChain(join(tmp, `rot-${i}.jsonl`), 2), 30, true);
resetLogger();
await bench("log/logEvent (no logger configured)", () => logEvent(record), 20000);
configureLogger({ root: tmp, appId: "hotbench", level: "info", console: false });
await bench("log/logEvent (default info, debug record filtered)", () => logEvent(record), 20000);
resetLogger();

// ---- runner, handler, request -------------------------------------------
const ctx = { emit() {} } as never;
const run = createRunner(handlers, ctx, openCaps);
await bench("async baseline (resolved promise)", async () => await Promise.resolve(), 5000, true);
configureLogger({ root: tmp, appId: "hotbench", level: "error", console: false });
const runnerFn = (i: number) => run("probe", "noop", input, "main", "main", 88);
await pair("runner/record filtered vs written", runnerFn, runnerFn, 1000,
	() => setLoggerLevel("error"), () => setLoggerLevel("debug"), () => setLoggerLevel("error"));
await flushLogger();
setLoggerLevel("debug");
const runGated = createRunner(handlers, ctx, gatedCaps);
await bench("runner/gated (compiled caps)", (i) => runGated("probe", "noop", input, "main", "main", 88), 3000, true);
const request = () => new Request("http://x/_crust/invoke", { method: "POST", headers: { authorization: "Bearer t", "content-type": "application/json" }, body });
await bench("invokeRequest (parse+run+response)", async () => invokeRequest(request(), new URL("http://x/_crust/invoke"), run, undefined, "main"), 1500, true);
const state = {
	options: { handlers: { "probe.noop": async () => input } }, csp: undefined, token: "t",
	devOrigins: [], events: new Events(), labels: new Map([["t", "main"]]), ledger: {} as never,
	port: () => 1234, run,
};
const fetchHandler = createHandler(state as never);
await bench("handler/invoke route full", async () => fetchHandler(request()), 1500, true);

// ---- event stream and timers --------------------------------------------
const ev = new Events();
const frames: string[] = [];
const sub = { enqueue(frame: string) { frames.push(frame); }, desiredSize: 10 };
await bench("events/emit (1 subscriber)", () => ev.emit("app:event", { event: "x", at: 1 }), 1000);
(ev as any).subscribers.add(sub);
await bench("events/emit + enqueue (1 subscriber)", () => ev.emit("app:event", { event: "x", at: 1 }), 1000);
(ev as any).subscribers.clear();
const fm = createFrameMemory({ native: { list: () => ["main"], getSize: () => ({ width: 800, height: 600 }), getPosition: () => ({ x: 10, y: 20 }) }, file: join(tmp, "frames.json"), workAreas: () => [] });
await bench("timer/frameMemory.sample (1 window)", () => fm.sample(), 5000);
const platform = { windowLabels: () => ["main"], window: () => ({}) } as never;
const tickWatch = watchWindows({ windows: [] } as never, platform, () => {}, 1e9);
clearInterval(tickWatch);
const pump = createPump();
await bench("timer/pump re-arm (single tick)", () => { pump.stop(); pump.start(1e9, () => {}); pump.stop(); }, 2000);
const source = { take: () => ["focus"] as string[], settle() {} };
const listeners = new Map([["focus", new Set([async () => {}])]]);
const lt = watchLifecycle(listeners as never, source as never, 1e9);
clearInterval(lt);
await flushLogger();
rmSync(tmp, { recursive: true, force: true });
console.log(`DONE keep=${sinkKeep.length} load=${load()} bun=${bunCount()}`);
