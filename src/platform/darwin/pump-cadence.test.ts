/**
 * The occluded pump. The shim returns -1 when no window is painting; the JS chain must then back
 * off and, the moment a window reports visible again, return to the normal cadence. Timing is driven
 * through a stubbed timer so a loaded host cannot turn this into a fifteen-minute false failure.
 */
import { describe, expect, test } from "bun:test";
import { createPump, OCCLUDED_PUMP_INTERVAL_MS } from "./pump.ts";

describe("the occluded pump cadence", () => {
	test("rejects a non-positive slow interval", () => {
		const pump = createPump();
		expect(() => pump.start(16, () => 0, 0)).toThrow(/slowMs/);
		pump.stop();
	});

	test("backs off on -1 and restores the normal cadence after a visible tick", () => {
		const realSet = globalThis.setTimeout;
		const realClear = globalThis.clearTimeout;
		const delays: number[] = [];
		let queued: (() => void) | undefined;
		globalThis.setTimeout = ((fn: () => void, ms: number) => {
			delays.push(ms);
			queued = fn;
			return 1 as unknown as ReturnType<typeof setTimeout>;
		}) as typeof setTimeout;
		globalThis.clearTimeout = (() => undefined) as typeof clearTimeout;
		try {
			const pump = createPump();
			let calls = 0;
			pump.start(4, () => (++calls <= 2 ? -1 : 0), 60);
			// start() ticks once immediately, then re-arms at the status it just saw.
			expect(delays).toEqual([60]);
			queued?.();
			expect(delays).toEqual([60, 60]);
			queued?.();
			expect(delays).toEqual([60, 60, 4]);
			pump.stop();
		} finally {
			globalThis.setTimeout = realSet;
			globalThis.clearTimeout = realClear;
		}
		// The constant must stay well under the bridge's 4000 ms page deadline even after several
		// round trips, and still be slower than a visible frame so the wakeup saving is real.
		expect(OCCLUDED_PUMP_INTERVAL_MS).toBeGreaterThan(16);
		expect(OCCLUDED_PUMP_INTERVAL_MS).toBeLessThanOrEqual(32);
	});
});
