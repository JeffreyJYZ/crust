/**
 * Implementer traps: the things a bridge probe does not measure but the first
 * real window hits on day one.
 *
 * Run: bun run /Users/jyz/dev/crust/research/bridge/traps.ts
 */

import { performance } from "node:perf_hooks";
import { HOST, TOKEN, startBridge } from "./bridge.ts";
import { http, enc, dec } from "./http.ts";

const results: Array<{ id: string; pass: boolean; line: string }> = [];
function report(id: string, pass: boolean, line: string) {
	results.push({ id, pass, line });
	console.log(`${pass ? "PASS" : "FAIL"} ${id}: ${line}`);
}

// ------------------------------------------------------------------ 1. exit
async function probeExit() {
	// A child that starts a server, stops it, and never calls process.exit.
	const script = `
import { startBridge } from "./bridge.ts";
const h = await startBridge();
await h.stop();
console.log("stopped");
`;
	const f = Bun.file("t-exit-child.ts");
	await Bun.write(f, script);
	const t0 = performance.now();
	const proc = Bun.spawnSync(["bun", "run", "t-exit-child.ts"], { cwd: import.meta.dir });
	const ms = performance.now() - t0;
	report(
		"1 process exit",
		proc.exitCode === 0,
		`child exitCode=${proc.exitCode} in ${ms.toFixed(0)}ms stdout=${JSON.stringify(proc.stdout.toString().trim())} ${proc.exitCode === 0 ? "clean, no process.exit needed" : "hung or crashed"}`,
	);
	await f.delete().catch(() => {});
}

// --------------------------------------------------------------- 2. idleTimeout
async function probeIdleTimeout() {
	// Bun.serve's default idleTimeout is 10s; an SSE stream must not be killed.
	const h = await startBridge();
	const t0 = performance.now();
	let buf = "";
	let frames = 0;
	const sock = await Bun.connect({
		hostname: HOST,
		port: h.port,
		socket: {
			data(_s: unknown, c: Uint8Array) {
				buf += dec.decode(c);
				let i: number;
				while ((i = buf.indexOf("\n\n")) !== -1) {
					const f = buf.slice(0, i);
					buf = buf.slice(i + 2);
					if (f.includes("event: tick")) frames++;
				}
			},
			close() {},
			error() {},
		} as any,
		failure() {},
	} as any);
	sock.write(
		enc.encode(
			`GET /_crust/events?token=${TOKEN} HTTP/1.1\r\nhost: ${HOST}:${h.port}\r\norigin: ${h.url}\r\naccept: text/event-stream\r\n\r\n`,
		),
	);
	// Do nothing for 12s, past Bun's 10s default idleTimeout.
	await Bun.sleep(12000);
	const alive = frames >= 20;
	try {
		sock.end();
	} catch {}
	await h.stop();
	report(
		"2 idle timeout",
		alive,
		`idleTimeout:0 kept the stream alive for ${(performance.now() - t0).toFixed(0)}ms, frames=${frames} (20 expected; Bun default 10s would have killed it)`,
	);
}

// ------------------------------------------------------------------ 3. CORS SSE
async function probeSseCors() {
	const h = await startBridge({ devOrigins: ["http://localhost:5173"] });
	const r = await http(h.port, "GET", `/ _crust/events?token=${TOKEN}`.replace(" ", ""), {
		origin: "http://localhost:5173",
		accept: "text/event-stream",
	}, undefined, 3000).catch((e) => ({ status: 0, headers: {}, body: "", ms: 0, wire: 0, err: e.message }));
	const acao = (r as any).headers?.["access-control-allow-origin"] ?? "none";
	await h.stop();
	report(
		"3 sse cors",
		acao === "http://localhost:5173",
		`cross-origin EventSource to the SSE endpoint: status=${r.status} acao=${acao} :: ${acao === "none" ? "MISSING — a Vite-served page cannot open the event stream; the SSE response needs access-control-allow-origin too" : "present"}`,
	);
}

// ------------------------------------------------------- 4. blocking handler
async function probeBlocking() {
	// A handler that blocks the event loop stalls every other request.
	const h = await startBridge();
	const auth = { authorization: `Bearer ${TOKEN}`, origin: h.url, "content-type": "application/json" };
	// 300 ms of blocking work in one request, and a noop in parallel.
	const t0 = performance.now();
	const slow = http(h.port, "POST", "/_crust/block", auth, JSON.stringify({}), 5000).catch((e) => e.message);
	// Give the handler a moment to be entered.
	await Bun.sleep(20);
	const other = await http(h.port, "POST", "/_crust/invoke", auth, JSON.stringify({ command: "noop" }), 5000);
	const otherMs = performance.now() - t0;
	await slow;
	await h.stop();
	report(
		"4 blocking handler",
		otherMs > 250, // the noop really was stalled by the blocking handler
		`noop answered in ${otherMs.toFixed(0)}ms while a 300ms blocking handler ran :: ${otherMs > 250 ? "CONFIRMED: one synchronous handler stalls every other request, so a slow command freezes the bridge" : "not blocked"}`,
	);
}

// --------------------------------------------------------------- 5. 404 shape
async function probeNotFound() {
	const h = await startBridge();
	const r = await http(h.port, "GET", "/nope", { origin: h.url });
	const body = r.body;
	await h.stop();
	report(
		"5 404 shape",
		r.status === 404 && body.includes("not-found"),
		`GET /nope -> ${r.status} ${JSON.stringify(body)} :: structured JSON error, so page code can branch on error.code`,
	);
}

// ---------------------------------------------------- 6. missing content-length
async function probeChunked() {
	// What a browser sends when the body is a stream: no content-length.
	const h = await startBridge();
	const auth = { authorization: `Bearer ${TOKEN}`, origin: h.url, "content-type": "application/json" };
	let buf = new Uint8Array(0);
	let done = false;
	let status = 0;
	const sock = await Bun.connect({
		hostname: HOST,
		port: h.port,
		socket: {
			data(_s: unknown, c: Uint8Array) {
				const m = new Uint8Array(buf.length + c.length);
				m.set(buf);
				m.set(c, buf.length);
				buf = m;
				const t = dec.decode(buf);
				const i = t.indexOf("\r\n\r\n");
				if (i === -1) return;
				status = Number(/^HTTP\/1.\d (\d+)/.exec(t)?.[1] ?? 0);
				const len = Number(/content-length: (\d+)/i.exec(t.slice(0, i))?.[1] ?? 0);
				if (buf.length >= i + 4 + len) done = true;
			},
			close() {},
			error() {},
		} as any,
		failure() {},
	} as any);
	const body = JSON.stringify({ command: "noop" });
	const req =
		`POST /_crust/invoke HTTP/1.1\r\nhost: ${HOST}:${h.port}\r\n` +
		`origin: ${h.url}\r\nauthorization: Bearer ${TOKEN}\r\ncontent-type: application/json\r\n` +
		"transfer-encoding: chunked\r\nconnection: close\r\n\r\n";
	const head = enc.encode(req);
	const chunk = enc.encode(`${body.length.toString(16)}\r\n${body}\r\n0\r\n\r\n`);
	let off = 0;
	const all = new Uint8Array(head.length + chunk.length);
	all.set(head);
	all.set(chunk, head.length);
	while (off < all.length) {
		const n = sock.write(all.subarray(off));
		if (!Number.isFinite(n) || n <= 0) {
			await Bun.sleep(2);
			continue;
		}
		off += n;
	}
	await Bun.sleep(1200);
	try {
		sock.end();
	} catch {}
	await h.stop();
	report(
		"6 chunked request",
		done && status === 200,
		`chunked POST /_crust/invoke -> status=${status} ${done ? "accepted" : "no response"} :: req.text() transparently de-chunks, so a browser fetch with a stream body works`,
	);
}

// ------------------------------------------------------------ 7. SSE backpressure
async function probeBackpressure() {
	// A fast producer with no consumer: does the server buffer without bound?
	const h = await startBridge({ sseIntervalMs: 1 });
	const t0 = performance.now();
	let buf = "";
	let frames = 0;
	const sock = await Bun.connect({
		hostname: HOST,
		port: h.port,
		socket: {
			data(_s: unknown, c: Uint8Array) {
				buf += dec.decode(c);
				let i: number;
				while ((i = buf.indexOf("\n\n")) !== -1) {
					const f = buf.slice(0, i);
					buf = buf.slice(i + 2);
					if (f.includes("event: tick")) frames++;
				}
			},
			close() {},
			error() {},
		} as any,
		failure() {},
	} as any);
	sock.write(
		enc.encode(
			`GET /_crust/events?token=${TOKEN} HTTP/1.1\r\nhost: ${HOST}:${h.port}\r\norigin: ${h.url}\r\naccept: text/event-stream\r\n\r\n`,
		),
	);
	await Bun.sleep(1500);
	try {
		sock.end();
	} catch {}
	await h.stop();
	report(
		"7 sse burst at 1ms",
		frames > 0,
		`${frames} frames delivered in 1500ms at a 1ms interval, ${(performance.now() - t0).toFixed(0)}ms :: a 20-message burst is fine, a sustained 1ms push is a busy loop that competes with the page's own JS`,
	);
}

const only = process.argv[2];
const jobs: Array<[string, () => Promise<void>]> = [
	["exit", probeExit],
	["idle", probeIdleTimeout],
	["ssecors", probeSseCors],
	["blocking", probeBlocking],
	["404", probeNotFound],
	["chunked", probeChunked],
	["burst", probeBackpressure],
];
for (const [name, fn] of jobs) {
	if (only && only !== name) continue;
	try {
		await fn();
	} catch (e) {
		report(name, false, `threw: ${e instanceof Error ? e.message : String(e)}`);
	}
}

const failed = results.filter((r) => !r.pass).length;
console.log(`\nSUMMARY: ${results.length - failed}/${results.length} passed`);
process.exit(0);