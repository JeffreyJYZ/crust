/**
 * The Windows display list, driven through a fake shim: what can be checked off Windows is the
 * arithmetic — ten doubles in, one record out — and that a shim which cannot enumerate answers an
 * empty list rather than a fabricated display.
 *
 * This unit has never been called against a real monitor, so these tests are the shape and the
 * numbers, not a claim that `EnumDisplayMonitors` returns what Windows documents.
 */

import { describe, expect, test } from "bun:test";
import { windowsScreenAdapter } from "./screen.ts";

/** A shim whose display answers are stated, so the arithmetic is the only variable. */
function fakeShim(count: number, rows: Float64Array[]) {
	return {
		shim_screen_count: () => count,
		shim_screen_info: (index: number, out: Float64Array) => {
			const row = rows[index];
			if (row === undefined) return 0;
			out.set(row);
			return 1;
		},
	} as unknown as import("./backend.ts").WindowsShim;
}

const PRIMARY = Float64Array.from([0, 0, 1440, 900, 0, 40, 1440, 860, 1, 1]);
const SECONDARY = Float64Array.from([1440, 0, 1920, 1080, 1440, 0, 1920, 1040, 1, 0]);

describe("the windows screen adapter", () => {
	test("answers every display the shim enumerated", () => {
		const adapter = windowsScreenAdapter(() => fakeShim(2, [PRIMARY, SECONDARY]));

		expect(adapter.list()).toEqual([
			{
				id: "0",
				primary: true,
				scale: 1,
				bounds: { x: 0, y: 0, width: 1440, height: 900 },
				workArea: { x: 0, y: 40, width: 1440, height: 860 },
			},
			{
				id: "1",
				primary: false,
				scale: 1,
				bounds: { x: 1440, y: 0, width: 1920, height: 1080 },
				workArea: { x: 1440, y: 0, width: 1920, height: 1040 },
			},
		]);
	});

	test("a shim that cannot enumerate answers an empty list, never a fabricated display", () => {
		const adapter = windowsScreenAdapter(() => fakeShim(0, []));
		expect(adapter.list()).toEqual([]);
	});

	test("a display whose record was refused is skipped, not answered as a zero rectangle", () => {
		// count says two, but the second index answers 0 — a display that vanished between the two
		// calls, which is exactly what a monitor unplugged mid-read looks like.
		const adapter = windowsScreenAdapter(() => fakeShim(2, [PRIMARY]));
		expect(adapter.list()).toHaveLength(1);
	});

	test("a non-finite or zero-size frame is dropped", () => {
		const broken = Float64Array.from([0, 0, 0, 0, 0, 0, 0, 0, 1, 1]);
		const adapter = windowsScreenAdapter(() => fakeShim(1, [broken]));
		expect(adapter.list()).toEqual([]);
	});
});
