/**
 * Concurrency probe: does Bun.serve on a single-threaded JS event loop
 * serialise requests, and how much does that inflate a single request's
 * measured latency under load?
 *
 * Run: bun run /Users/jyz/dev/crust/research/bridge/concurrency.ts
 */
import { performance } from "node:perf_hooks";

const BOUND = 200; // ms of blocking CPU work per request

const s = Bun.serve({
	hostname: "127.0.0.1",
	port: 0,
	idleTimeout: 0,
	async fetch() {
		const t = Date.now();
		while (Date.now() - t < BOUND) {}
		return new Response("x");
	},
});

const port = s.port;
const one = async (tag: string) => {
	const t0 = performance.now();
	const r = await fetch(`http://127.0.0.1:${port}/`);
	await r.text();
	return { tag, ms: +(performance.now() - t0).toFixed(1) };
};

const serial: number[] = [];
for (let i = 0; i < 3; i++) {
	const r = await one(`s${i}`);
	serial.push(r.ms);
}

const t0 = performance.now();
const parallel = await Promise.all([one("p1"), one("p2"), one("p3")]);
const parallelWall = performance.now() - t0;

console.log("serial ms      :", serial.join(", "));
console.log("parallel ms    :", parallel.map((p) => p.ms).join(", "));
console.log("parallel wall  :", parallelWall.toFixed(1) + "ms (3 x " + BOUND + "ms of blocking work)");
console.log("VERDICT:", parallelWall > BOUND * 2.2 ? "SERIALISED by the event loop" : "overlapped");

await s.stop(true);
process.exit(0);