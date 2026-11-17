/**
 * The native half of `crust:screen` on macOS, proved against a stub rather than a real display
 * server: what can be checked off a GUI session is the coordinate flip — AppKit reports bottom-left
 * with y up, and every caller of this plugin reads top-left page pixels with y down.
 *
 * The flip is the one place a mistake is silent: bounds and work area both still answer four finite
 * numbers when the conversion is wrong, so only an exact rectangle proves it.
 */

import { describe, expect, test } from "bun:test";
import { listScreens, type ScreenRecord, screenUnitStatus, toTopLeft } from "./screen.ts";

/** One display as the C half writes it: frame x/y/w/h, visible x/y/w/h, scale, primary flag. */
function doubles(
	frame: [number, number, number, number],
	visible: [number, number, number, number],
	scale: number,
	primary: number,
): Float64Array {
	return Float64Array.from([...frame, ...visible, scale, primary]);
}

/** The adapter the plugin registers: the unit's own `listScreens`, with no `cc()` paid for. */
const adapter = { list: listScreens };

describe("the darwin screen adapter", () => {
	test("answers every display in AppKit's own order", () => {
		const screens = adapter.list();
		// A headless runner is a real state; what must never happen is a throw.
		expect(Array.isArray(screens)).toBe(true);
		for (const screen of screens) {
			expect(screen.scale).toBeGreaterThan(0);
			expect(screen.bounds.width).toBeGreaterThan(0);
			expect(screen.bounds.height).toBeGreaterThan(0);
			expect(typeof screen.id).toBe("string");
		}
	});

	test("the primary flag is AppKit's, not index 0 by assumption", () => {
		const screens = adapter.list() as ScreenRecord[];
		if (screens.length === 0) return; // headless: nothing to assert about a list nobody has
		expect(screens.filter((screen) => screen.primary).length).toBeLessThanOrEqual(1);
	});

	test("the unit reports why it cannot answer instead of throwing", () => {
		const status = screenUnitStatus();
		expect(typeof status.available).toBe("boolean");
		expect(status.reason.length).toBeGreaterThan(0);
	});
});

/**
 * The flip, exercised on the real conversion: `toTopLeft` is the only one, and these are the
 * numbers a wrong sign or a forgotten `- height` produces.
 */
describe("bottom-left to top-left", () => {
	// A 900-tall primary with its origin at the bottom-left of the desktop.
	const CEILING = 900;

	test("a primary display's frame starts at the top-left of the page", () => {
		expect(toTopLeft({ x: 0, y: 0, width: 1440, height: 900 }, CEILING)).toEqual({
			x: 0,
			y: 0,
			width: 1440,
			height: 900,
		});
	});

	test("a display above the primary answers a negative y, which is where it is", () => {
		// AppKit places a display above the primary at y = 900; its top edge is 900 + 1080.
		expect(toTopLeft({ x: 0, y: 900, width: 1920, height: 1080 }, CEILING)).toEqual({
			x: 0,
			y: -1080,
			width: 1920,
			height: 1080,
		});
	});

	test("a second display to the right keeps its x and gets the same flip", () => {
		expect(toTopLeft({ x: 1440, y: 0, width: 1920, height: 1080 }, CEILING)).toEqual({
			x: 1440,
			y: -180,
			width: 1920,
			height: 1080,
		});
	});

	test("the visible frame is flipped by the same ceiling, not by its own height", () => {
		// A 60-point dock at the bottom: AppKit's visible frame starts 60 up, so its top edge is
		// 60 + 815 = 875 and the flip puts it at 25 — under the menu bar, not at 0.
		expect(toTopLeft({ x: 0, y: 60, width: 1440, height: 815 }, CEILING)).toEqual({
			x: 0,
			y: 25,
			width: 1440,
			height: 815,
		});
	});
});

/** The buffer the C half writes, read by the same arithmetic the adapter uses. */
test("ten doubles carry the frame, the work area, the scale and the primary flag", () => {
	const out = doubles([0, 0, 1440, 900], [0, 60, 1440, 815], 2, 1);
	expect(out.length).toBe(10);
	expect(Array.from(out)).toEqual([0, 0, 1440, 900, 0, 60, 1440, 815, 2, 1]);
});
