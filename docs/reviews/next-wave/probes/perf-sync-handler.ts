/**
 * Lane B1 benchmark: what a user feels when a plugin handler blocks the bridge.
 *
 * Run: bun run docs/reviews/next-wave/probes/perf-sync-handler.ts
 *
 * Starts a real bridge (Bun.serve, token + origin checks intact), registers two commands:
 *   perf.block — a SYNCHRONOUS 200 ms handler (busy-wait, so it truly blocks the JS loop)
 *   perf.yield — an ASYNC 200 ms handler (await, the control)
 * Fires three concurrent invokes and records wall time, per-invoke latency, and pump ticks.
 *
 * The pump is a self-rearming 16 ms setTimeout chain — the exact mechanism the platform uses to
 * drive native repaint (src/platform/darwin/platform.ts:64-78, PUMP_INTERVAL_MS in app-types.ts:98).
 * A tick cannot fire while the loop is blocked, so a gap in ticks is a window with no repaint.
 *
 * Prints detail lines, then one SUMMARY line. No code change to the bridge.
 */
import { performance } from "node:perf_hooks";

import { PUMP_INTERVAL_MS } from "../../../../src/app-types.ts";
import { startBridge, type BridgeHandle } from "../../../../src/bridge/server.ts";

const BOUND_MS = 200;
const COUNT = 3;
const fmt = (n: number): string => n.toFixed(1);

/** A genuinely blocking sleep. An awaited timer would yield and hide the defect. */
function blockingSleep(ms: number): void {
	const until = performance.now() + ms;
	while (performance.now() < until) {}
}

function invokeHeaders(bridge: BridgeHandle): Record<string, string> {
	return {
		"content-type": "application/json",
		origin: bridge.url,
		authorization: `Bearer ${bridge.token}`,
	};
}

async function invoke(bridge: BridgeHandle, command: string): Promise<number> {
	const start = performance.now();
	const response = await fetch(`${bridge.url}/_crust/invoke`, {
		method: "POST",
		headers: invokeHeaders(bridge),
		body: JSON.stringify({ plugin: "perf", command, args: {} }),
	});
	await response.arrayBuffer();
	if (!response.ok) throw new Error(`invoke ${command}: HTTP ${response.status}`);
	return performance.now() - start;
}

/** Self-rearming pump, identical to the platform repaint timer. Returns its tick timestamps. */
function startPump(): { times: number[]; stop: () => void } {
	const times: number[] = [];
	let running = true;
	const tick = (): void => {
		if (!running) return;
		times.push(performance.now());
		setTimeout(tick, PUMP_INTERVAL_MS);
	};
	tick();
	return { times, stop: () => { running = false; } };
}

function maxGap(times: number[]): number {
	let gap = 0;
	let prev = times[0];
	for (const t of times) {
		if (prev !== undefined) gap = Math.max(gap, t - prev);
		prev = t;
	}
	return gap;
}

interface Measure {
	wall: number;
	latencies: number[];
	gap: number;
	inWindow: number;
	expected: number;
}

async function measure(bridge: BridgeHandle, command: string): Promise<Measure> {
	// Let the pump establish a baseline before the invokes begin.
	await new Promise((resolve) => setTimeout(resolve, PUMP_INTERVAL_MS * 3));
	const pump = startPump();
	await new Promise((resolve) => setTimeout(resolve, PUMP_INTERVAL_MS * 2));

	const t0 = performance.now();
	const latencies = await Promise.all(
		Array.from({ length: COUNT }, () => invoke(bridge, command)),
	);
	const wall = performance.now() - t0;
	const t1 = performance.now();
	pump.stop();

	return {
		wall,
		latencies,
		gap: maxGap(pump.times),
		inWindow: pump.times.filter((t) => t >= t0 && t <= t1).length,
		expected: Math.round(wall / PUMP_INTERVAL_MS),
	};
}

const bridge = startBridge({
	handlers: {
		"perf.block": () => {
			blockingSleep(BOUND_MS);
			return "ok";
		},
		"perf.yield": async () => {
			await Bun.sleep(BOUND_MS);
			return "ok";
		},
	},
});

try {
	const blocked = await measure(bridge, "block");
	const control = await measure(bridge, "yield");

	console.log(
		`block (${COUNT} x ${BOUND_MS}ms sync): wall ${fmt(blocked.wall)}ms, invokes ${blocked.latencies.map(fmt).join("/")}ms`,
	);
	console.log(
		`  pump ticks in window ${blocked.inWindow} (healthy ~${blocked.expected}), max gap ${fmt(blocked.gap)}ms`,
	);
	console.log(
		`control (${COUNT} x ${BOUND_MS}ms async): wall ${fmt(control.wall)}ms, invokes ${control.latencies.map(fmt).join("/")}ms`,
	);
	console.log(
		`  pump ticks in window ${control.inWindow} (healthy ~${control.expected}), max gap ${fmt(control.gap)}ms`,
	);
	console.log(
		`SUMMARY: ${COUNT} synchronous ${BOUND_MS}ms handlers serialise to ${fmt(blocked.wall)}ms wall; pump stalled ${fmt(blocked.gap)}ms (no repaint); invokes queued ${blocked.latencies.map(fmt).join("/")}ms. Async control overlaps to ${fmt(control.wall)}ms.`,
	);
} finally {
	await bridge.stop();
}
process.exit(0);
