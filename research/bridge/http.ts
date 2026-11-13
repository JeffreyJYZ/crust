/**
 * A tiny HTTP/1.1 client over a TCP socket.
 *
 * Why not fetch(): this probe measures wire bytes and per-request latency
 * without Bun's connection pool in the way, and it exposes a real trap:
 * `socket.write()` accepts fewer bytes than it was handed (measured 327212 of
 * 614621) and drops the rest silently, so the writer loops until the whole
 * request is on the wire.
 *
 * fetch() to loopback is NOT proxied here (verified: server.requestIP() reports
 * [IP_ADDRESS] for a fetch call), so fetch timings are real too; this client is
 * the measuring instrument, not a workaround.
 */

import { HOST } from "./bridge.ts";

export const enc = new TextEncoder();
export const dec = new TextDecoder();

export interface Reply {
	status: number;
	headers: Record<string, string>;
	body: string;
	ms: number;
	wire: number;
}

export async function http(
	port: number,
	method: string,
	path: string,
	headers: Record<string, string>,
	body?: Uint8Array | string,
	timeoutMs = 15000,
): Promise<Reply> {
	const t0 = performance.now();
	const bb = typeof body === "string" ? enc.encode(body) : (body ?? new Uint8Array(0));
	const lines = [`${method} ${path} HTTP/1.1`, `host: ${HOST}:${port}`];
	for (const [k, v] of Object.entries(headers)) lines.push(`${k}: ${v}`);
	lines.push("connection: close");
	if (bb.length || method === "POST") lines.push(`content-length: ${bb.length}`);
	const head = lines.join("\r\n") + "\r\n\r\n";
	const wire = new Uint8Array(head.length + bb.length);
	wire.set(enc.encode(head));
	wire.set(bb, head.length);

	let buf = new Uint8Array(0);
	let settled = false;
	let saved: Error | null = null;
	const waiters: Array<() => void> = [];
	const wake = () => {
		for (const f of waiters.splice(0)) f();
	};

	const full = (): boolean => {
		const text = dec.decode(buf);
		const i = text.indexOf("\r\n\r\n");
		if (i === -1) return false;
		const len = Number(/content-length: (\d+)/i.exec(text.slice(0, i))?.[1] ?? 0);
		return buf.length >= i + 4 + len;
	};

	const sock = await Bun.connect({
		hostname: HOST,
		port,
		socket: {
			data(_s: unknown, c: Uint8Array) {
				if (settled) return;
				const m = new Uint8Array(buf.length + c.length);
				m.set(buf);
				m.set(c, buf.length);
				buf = m;
				if (full()) {
					settled = true;
					wake();
				}
			},
			close() {
				if (settled) return;
				saved = new Error("closed before full response");
				settled = true;
				wake();
			},
			error(e: any) {
				if (settled) return;
				saved = new Error(e?.message ? String(e.message) : "socket error");
				settled = true;
				wake();
			},
		} as any,
		failure(e: any) {
			if (settled) return;
			saved = new Error(e?.message ? String(e.message) : "connect failed");
			settled = true;
			wake();
		},
	} as any);

	// Write only after the connect promise resolves: writing from inside the
	// open() callback races Bun's own setup and kills the socket.
	// socket.write() can accept fewer bytes than handed to it (measured: 327212
	// of 614621), and the remainder is dropped silently, so loop until the whole
	// request is on the wire.
	let off = 0;
	while (off < wire.length) {
		const n = sock.write(wire.subarray(off));
		if (!Number.isFinite(n) || n <= 0) {
			await Bun.sleep(1);
			continue;
		}
		off += n;
		if (off < wire.length) await Bun.sleep(1);
	}

	const timer = setTimeout(() => {
		if (settled) return;
		saved = new Error(`timeout after ${timeoutMs}ms`);
		settled = true;
		wake();
	}, timeoutMs);

	while (!settled) await new Promise<void>((r) => waiters.push(r));
	clearTimeout(timer);
	try {
		sock.end();
	} catch {}

	if (saved) throw saved;

	const text = dec.decode(buf);
	const i = text.indexOf("\r\n\r\n");
	const h = text.slice(0, i);
	const len = Number(/content-length: (\d+)/i.exec(h)?.[1] ?? 0);
	const hs: Record<string, string> = {};
	for (const l of h.split("\r\n").slice(1)) {
		const k = l.indexOf(":");
		if (k > 0) hs[l.slice(0, k).trim().toLowerCase()] = l.slice(k + 1).trim();
	}
	return {
		status: Number(/^HTTP\/1.\d (\d+)/.exec(h)?.[1] ?? 0),
		headers: hs,
		body: dec.decode(buf.slice(i + 4, i + 4 + len)),
		ms: performance.now() - t0,
		wire: wire.length,
	};
}