import { describe, expect, test } from "bun:test";
import { DarwinPlatform, windowLiveness } from "./index.ts";

describe("window liveness", () => {
	/**
	 * The defect this rule exists for: `-windowNumber` never reads 0 after a
	 * close. Measured 2026-11-13 on macOS 27 — `-close` ordered the window out
	 * (`isVisible` 1 → 0 in 1.02 ms, still 0 after 300 ms and after 1 s of
	 * pumping) while the window device number stayed 517, and stayed 518 for a
	 * second window that got `-orderOut:` before `-close`.
	 */
	test("a closed window is gone even though AppKit keeps its device number", () => {
		expect(windowLiveness({ visible: false, miniaturized: false, appHidden: false })).toBe(
			false,
		);
	});

	test("a minimised window and a hidden app are both still open", () => {
		expect(windowLiveness({ visible: false, miniaturized: true, appHidden: false })).toBe(true);
		expect(windowLiveness({ visible: false, miniaturized: false, appHidden: true })).toBe(true);
	});

	test("an ordinary on-screen window is open", () => {
		expect(windowLiveness({ visible: true, miniaturized: false, appHidden: false })).toBe(true);
	});
});

describe("pump timer", () => {
	test("starts, ticks, and stops without leaving a timer", async () => {
		const platform = new DarwinPlatform();
		platform.pump(16);
		expect(platform.pumping).toBe(true);
		expect(platform.ticks).toBeGreaterThan(0);

		await Bun.sleep(60);
		expect(platform.ticks).toBeGreaterThan(1);

		platform.stopPump();
		expect(platform.pumping).toBe(false);
		const stoppedAt = platform.ticks;

		// If the chain re-armed itself the counter would keep climbing.
		await Bun.sleep(60);
		expect(platform.ticks).toBe(stoppedAt);
	});

	test("refuses a non-positive interval", () => {
		const platform = new DarwinPlatform();
		expect(() => platform.pump(0)).toThrow();
		expect(() => platform.pump(-1)).toThrow();
	});
});
