/**
 * SSE burst coalescing: are N pushes in a single tick delivered as one chunk?
 * Run: bun run /Users/jyz/dev/crust/research/bridge/sse-burst.ts
 */
import { performance } from "node:perf_hooks";

const N = 50;
const TOKEN = "burst";
const enc = new TextEncoder();

const s = Bun.serve({
	hostname: "localhost",
	port: 0,
	idleTimeout: 0,
	async fetch(req) {
		const url = new URL(req.url);
		if (url.pathname !== "/events") return new Response("no");
		const stream = new ReadableStream({
			start(controller) {
				// No awaits, no timers: everything in one synchronous burst.
				for (let i = 0; i < N; i++) {
					controller.enqueue(enc.encode(`event: tick\ndata: ${i}\n\n`));
				}
				controller.close();
			},
		});
		return new Response(stream, { headers: { "content-type": "text/event-stream" } });
	},
});

const port = s.port;
const t0 = performance.now();
const res = await fetch(`http://localhost:${port}/events`);
const reader = res.body!.getReader();
const chunkSizes: number[] = [];
let bytes = 0;
while (true) {
	const { value, done } = await reader.read();
	if (done) break;
	chunkSizes.push(value.byteLength);
	bytes += value.byteLength;
}
const total = performance.now() - t0;

const lines = new TextDecoder().decode(
	Buffer.concat(
		chunkSizes.map((n) => {
			const b = new Uint8Array(n);
			return Buffer.from(b);
		}),
	),
);
const events = lines.split("\n\n").filter((p) => p.includes("data:")).length;

console.log(`pushes=${N} chunks=${chunkSizes.length} chunkBytes=${chunkSizes.join(",")}`);
console.log(`events parsed=${events} total=${total.toFixed(1)}ms bytes=${bytes}`);
console.log("VERDICT:", chunkSizes.length < 5 ? "COALESCED into one chunk" : "each push its own chunk");

await s.stop(true);
process.exit(0);