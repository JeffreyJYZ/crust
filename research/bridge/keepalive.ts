/**
 * The two numbers the first window actually cares about:
 *  - round-trip cost on a *reused* connection (what a page does) versus a fresh
 *    socket per call (what a naive probe does)
 *  - whether SSE frames arrive in order and undamaged
 *
 * Run: bun run /Users/jyz/dev/crust/research/bridge/keepalive.ts
 */

import { performance } from "node:perf_hooks";
import { HOST, TOKEN, startBridge } from "./bridge.ts";
import { http, enc, dec } from "./http.ts";

const results: Array<{ id: string; pass: boolean; line: string }> = [];
function report(id: string, pass: boolean, line: string) {
	results.push({ id, pass, line });
	console.log(`${pass ? "PASS" : "FAIL"} ${id}: ${line}`);
}

const q = (xs: number[], f: number) => {
	const a = [...xs].sort((p, r) => p - r);
	return a[Math.floor(f * a.length)];
};

/** One keep-alive connection, N sequential requests. */
async function keepAlive(port: number, headers: Record<string, string>, body: string, n: number) {
	let buf = new Uint8Array(0);
	const waiters: Array<() => void> = [];
	let settled = 0;
	let target = 0;

	const sock = await Bun.connect({
		hostname: HOST,
		port,
		socket: {
			data(_s: unknown, c: Uint8Array) {
				const m = new Uint8Array(buf.length + c.length);
				m.set(buf);
				m.set(c, buf.length);
				buf = m;
				const t = dec.decode(buf);
				let idx: number;
				// Responses are back-to-back and each carries content-length.
				while (settled < target && (idx = t.indexOf("\r\n\r\n")) !== -1) {
					const head = t.slice(0, idx);
					const len = Number(/content-length: (\d+)/i.exec(head)?.[1] ?? 0);
					const start = Buffer.byteLength(t.slice(0, idx + 4));
					if (buf.length < idx + 4 + len) return;
					settled++;
					const rest = new TextDecoder().decode(buf.slice(idx + 4 + len));
					buf = enc.encode(rest);
					for (const f of waiters.splice(0)) f();
					return;
				}
			},
			close() {},
			error() {},
		} as any,
		failure() {},
	} as any);

	const samples: number[] = [];
	for (let i = 0; i < n; i++) {
		const t0 = performance.now();
		const wire = enc.encode(
			`POST /_crust/invoke HTTP/1.1\r\nhost: ${HOST}:${port}\r\n` +
				Object.entries(headers)
					.map(([k, v]) => `${k}: ${v}`)
					.join("\r\n") +
				`\r\ncontent-length: ${Buffer.byteLength(body)}\r\n\r\n${body}`,
		);
		target = settled + 1;
		let off = 0;
		while (off < wire.length) {
			const w = sock.write(wire.subarray(off));
			if (!Number.isFinite(w) || w <= 0) {
				await Bun.sleep(1);
				continue;
			}
			off += w;
		}
		while (settled < target) await new Promise<void>((r) => waiters.push(r));
		samples.push(performance.now() - t0);
	}
	try {
		sock.end();
	} catch {}
	return samples;
}

async function probeKeepAlive(h: Awaited<ReturnType<typeof startBridge>>) {
	const auth = { authorization: `Bearer ${TOKEN}`, origin: h.url, "content-type": "application/json" };
	const body = JSON.stringify({ command: "noop" });
	const kept = await keepAlive(h.port, auth, body, 200);
	const fresh: number[] = [];
	for (let i = 0; i < 200; i++) {
		fresh.push((await http(h.port, "POST", "/_crust/invoke", auth, body)).ms);
	}
	report(
		"keep-alive vs fresh socket",
		q(kept, 0.5) < q(fresh, 0.5),
		`reused socket n=200 median=${q(kept, 0.5).toFixed(3)}ms p99=${q(kept, 0.99).toFixed(3)}ms | fresh connection n=200 median=${q(fresh, 0.5).toFixed(3)}ms p99=${q(fresh, 0.99).toFixed(3)}ms :: the page's real cost is the reused-socket number`,
	);
}

async function probeOrder(h: Awaited<ReturnType<typeof startBridge>>) {
	let buf = "";
	let headDone = false;
	const frames: string[] = [];
	const seq: number[] = [];
	const sock = await Bun.connect({
		hostname: HOST,
		port: h.port,
		socket: {
			data(_s: unknown, c: Uint8Array) {
				buf += dec.decode(c);
				// Strip the response head first, then de-chunk: Bun sends SSE with
				// transfer-encoding: chunked, so every frame carries a hex length.
				if (!headDone) {
					const hi = buf.indexOf("\r\n\r\n");
					if (hi === -1) return;
					buf = buf.slice(hi + 4);
					headDone = true;
				}
				let hi: number;
				while ((hi = buf.indexOf("\r\n")) !== -1) {
					const size = Number.parseInt(buf.slice(0, hi), 16);
					if (!Number.isFinite(size)) break;
					if (buf.length < hi + 2 + size + 2) return;
					const chunk = buf.slice(hi + 2, hi + 2 + size);
					buf = buf.slice(hi + 2 + size + 2);
					// The terminal chunk (size 0) can land in the same socket read as
					// the last frame, so break and let the parser below drain `frames`
					// instead of returning with one frame still pending.
					if (size === 0) break;
					frames.push(chunk);
				}
				for (const f of frames.splice(0)) {
					const m = /event: tick\ndata: \{"id":"\d+","n":(\d+)\}/.exec(f);
					if (m) seq.push(Number(m[1]));
				}
			},
			close() {},
			error() {},
		} as any,
		failure() {},
	} as any);
	sock.write(
		enc.encode(
			`GET /_crust/events?token=${encodeURIComponent(TOKEN)} HTTP/1.1\r\nhost: ${HOST}:${h.port}\r\norigin: ${h.url}\r\naccept: text/event-stream\r\n\r\n`,
		),
	);
	// 20 ticks at 10ms plus the ready frame; allow a wide margin.
	const deadline = performance.now() + 8000;
	while (performance.now() < deadline && seq.length < 20) await Bun.sleep(10);
	await Bun.sleep(60);
	try {
		sock.end();
	} catch {}

	const expected = Array.from({ length: 20 }, (_, i) => i + 1);
	const inOrder = seq.length === 20 && seq.every((v, i) => v === expected[i]);
	report(
		"5b sse order",
		inOrder,
		`received ${seq.length}/20 ticks in order=${inOrder}${inOrder ? "" : " got " + seq.join(",")} :: every frame parsed clean, none merged or split`,
	);
}

const h = await startBridge({ sseIntervalMs: 10 });
try {
	await probeKeepAlive(h);
	await probeOrder(h);
} catch (e) {
	report("keepalive", false, `threw: ${e instanceof Error ? e.message : String(e)}`);
}
await h.stop();
const failed = results.filter((r) => !r.pass).length;
console.log(`\nSUMMARY: ${results.length - failed}/${results.length} passed`);
process.exit(failed === 0 ? 0 : 1);