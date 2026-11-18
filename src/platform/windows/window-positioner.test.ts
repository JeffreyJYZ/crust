/**
 * `crust:positioner` on Windows: the nine placements, proved against the real plugin so the numbers
 * that land are the ones a page would see.
 *
 * The whole reason this namespace was refused is the axis. AppKit's `y` grows upward from the bottom
 * of the screen, Win32's grows downward from the top, so a straight port puts `topLeft` at the bottom
 * edge. The conversion is one subtraction, and these tests are what makes it a fact rather than a
 * comment: a `topLeft` window must land on the work area's own top edge, and a `bottomLeft` one must
 * end at its bottom edge, taskbar excluded.
 */
import { describe, expect, test } from "bun:test";
import { createPositionerPlugin, type PositionerNative } from "@/plugins/positioner";
import type { ScreenRecord } from "@/plugins/screen";
import { primaryWorkArea, windowsPositioner } from "./window-positioner.ts";

/** 1920×1080 with a 40-pixel taskbar at the bottom: `rcWork` is what a placement must respect. */
const PRIMARY: ScreenRecord = {
	id: "0",
	primary: true,
	scale: 1,
	bounds: { x: 0, y: 0, width: 1920, height: 1080 },
	workArea: { x: 0, y: 0, width: 1920, height: 1040 },
};

/** A second display to the right, offset down: the numbers a "main screen" assumption would miss. */
const SECOND: ScreenRecord = {
	id: "1",
	primary: false,
	scale: 1,
	bounds: { x: 1920, y: 200, width: 1280, height: 800 },
	workArea: { x: 1920, y: 200, width: 1280, height: 800 },
};

/** A window that records the move the plugin makes, at a fixed size. */
function windowOf(
	width = 800,
	height = 600,
): {
	native: PositionerNative;
	placed: Array<{ x: number; y: number }>;
} {
	const placed: Array<{ x: number; y: number }> = [];
	return {
		placed,
		native: {
			list: () => ["main"],
			getSize: () => ({ width, height }),
			setPosition: (_label, point) => {
				placed.push(point);
			},
		},
	};
}

describe("the work area a placement measures against", () => {
	test("is the primary display's rcWork, taskbar excluded", () => {
		expect(primaryWorkArea([SECOND, PRIMARY])).toEqual({
			x: 0,
			y: 0,
			width: 1920,
			height: 1040,
		});
	});

	test("falls back to the first display when none is marked primary", () => {
		expect(primaryWorkArea([{ ...PRIMARY, primary: false }])?.height).toBe(1040);
	});

	test("no display, or one with no area, is undefined rather than a guess", () => {
		expect(primaryWorkArea([])).toBeUndefined();
		expect(
			primaryWorkArea([{ ...PRIMARY, workArea: { x: 0, y: 0, width: 0, height: 0 } }]),
		).toBeUndefined();
	});
});

describe("the nine placements land in Win32's y-down space", () => {
	const cases: Array<[string, number, number]> = [
		["topLeft", 0, 0],
		["topRight", 1120, 0],
		["bottomLeft", 0, 440],
		["bottomRight", 1120, 440],
		["topCenter", 560, 0],
		["bottomCenter", 560, 440],
		["leftCenter", 0, 220],
		["rightCenter", 1120, 220],
		["center", 560, 220],
	];

	for (const [placement, x, y] of cases) {
		test(`${placement} is ${x},${y}`, async () => {
			const { native, placed } = windowOf();
			const plugin = createPositionerPlugin(windowsPositioner(native, () => [PRIMARY]));
			const command = (plugin.commands as unknown as Record<string, (a: unknown) => unknown>)[
				placement
			];
			expect(await command?.({ label: "main" })).toMatchObject({
				ok: true,
				x,
				y,
			});
			expect(placed).toEqual([{ x, y }]);
		});
	}

	test("a second display's offset is carried, not flattened to zero", async () => {
		const { native, placed } = windowOf();
		const plugin = createPositionerPlugin(windowsPositioner(native, () => [SECOND, PRIMARY]));
		// PRIMARY is primary here; swap it so the offset display is the one measured.
		const offset = createPositionerPlugin(
			windowsPositioner(native, () => [{ ...SECOND, primary: true }]),
		);
		await (offset.commands as unknown as Record<string, (a: unknown) => unknown>).topLeft?.({
			label: "main",
		});
		expect(placed.at(-1)).toEqual({ x: 1920, y: 200 });
		// And the real list, where PRIMARY wins, is the un-offset one.
		await (plugin.commands as unknown as Record<string, (a: unknown) => unknown>).topLeft?.({
			label: "main",
		});
		expect(placed.at(-1)).toEqual({ x: 0, y: 0 });
	});

	test("a window bigger than the work area keeps its negative offset", async () => {
		const { native, placed } = windowOf(2400, 1200);
		const plugin = createPositionerPlugin(windowsPositioner(native, () => [PRIMARY]));
		await (plugin.commands as unknown as Record<string, (a: unknown) => unknown>).center?.({
			label: "main",
		});
		// The plugin rounds the slack; what matters is that the flip is applied to it.
		expect(placed[0]?.y).toBe(1040 - (Math.round((1040 - 1200) / 2) + 1200));
	});

	test("no display means the plugin's own named refusal, not a move", async () => {
		const { native, placed } = windowOf();
		const plugin = createPositionerPlugin(windowsPositioner(native, () => []));
		const answer = await (
			plugin.commands as unknown as Record<string, (a: unknown) => unknown>
		).center?.({ label: "main" });
		expect(answer).toMatchObject({ ok: false, code: "unknown-adapter" });
		expect(placed).toEqual([]);
	});
});
