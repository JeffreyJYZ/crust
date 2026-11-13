/**
 * Two questions a page's `fetch()` raises that a raw socket cannot answer:
 *
 *  1. Is `fetch()` to loopback proxied on this machine? (Earlier note in this
 *     folder said yes; that was wrong. This prints the peer address the server
 *     actually sees.)
 *  2. Does the page-side client (`client.ts`) work end to end, and what does a
 *     1 MB invoke cost through `fetch` rather than through a raw socket?
 *
 * Run: bun run /Users/jyz/dev/crust/research/bridge/fetch-path.ts
 */

import { performance } from "node:perf_hooks";
import { HOST, TOKEN, startBridge, installProbeCommands } from "./bridge.ts";
import { BridgeClient } from "./client.ts";

const results: Array<{ id: string; pass: boolean }> = [];
function report(id: string, pass: boolean, line: string) {
	results.push({ id, pass });
	console.log(`${pass ? "PASS" : "FAIL"} ${id}: ${line}`);
}

// ------------------------------------------------------------- 1. peer address
async function probePeer() {
	// A bare server, so the peer address is the only thing in the response.
	const s = Bun.serve({
		hostname: HOST,
		port: 0,
		idleTimeout: 0,
		fetch(req) {
			const ip = s.requestIP(req);
			return Response.json({ peer: ip?.address ?? null, family: ip?.family ?? null });
		},
	});
	const res = await fetch(`http://${HOST}:${s.port}/`);
	const body = (await res.json()) as { peer: string | null; family: string | null };
	await s.stop(true);
	report(
		"9 fetch peer",
		body.peer === HOST,
		`fetch() to ${HOST} arrives from peer=${body.peer} family=${body.family} :: loopback is not proxied, so fetch timings are real`,
	);
}

// ---------------------------------------------------------- 2. client end-to-end
async function probeClient() {
	const h = await startBridge();
	installProbeCommands();
	const c = new BridgeClient({ baseUrl: h.url, token: TOKEN });

	const pong = await c.invoke<string>({ command: "noop" });
	const t0 = performance.now();
	const big = await c.invoke<{ ok: boolean; blob: string }>({ command: "big", args: { kb: 1024 } });
	const ms = performance.now() - t0;
	const bytes = big.blob.length;

	// A structured failure must arrive as a rejected promise, not a 200.
	let code = "";
	try {
		await c.invoke({ command: "boom" });
	} catch (e) {
		code = String((e as { code?: string }).code ?? "");
	}
	await h.stop();
	report(
		"10 client",
		pong === "pong" && bytes === 1024 * 1024 && code === "handler-error",
		`BridgeClient.invoke: noop=${JSON.stringify(pong)} | 1MB response ${bytes} bytes in ${ms.toFixed(2)}ms | handler throw -> code=${JSON.stringify(code)}`,
	);
}

try {
	await probePeer();
	await probeClient();
} catch (e) {
	report("fetch-path", false, `threw: ${e instanceof Error ? e.message : String(e)}`);
}

const failed = results.filter((r) => !r.pass).length;
console.log(`\nSUMMARY: ${results.length - failed}/${results.length} passed`);
process.exit(failed === 0 ? 0 : 1);
