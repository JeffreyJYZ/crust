/**
 * The rule that decides whether a remembered frame may be restored. The three cases the brief names
 * are the whole point: a frame fully off every display is the gone-monitor bug, a frame hanging off
 * an edge is a resize the human made, and a frame inside a work area is the ordinary case.
 */

import { describe, expect, test } from "bun:test";
import { restorableFrame, visibleOverlap } from "./window-frame.ts";

/** One 1440x900 display whose work area starts below a 25-point menu bar. */
const DISPLAY = { x: 0, y: 25, width: 1440, height: 875 };

describe("restorableFrame", () => {
	test("fully off-screen is rejected", () => {
		expect(restorableFrame({ x: -2200, y: 100, width: 800, height: 600 }, [DISPLAY])).toBe(
			false,
		);
		expect(restorableFrame({ x: 100, y: 1400, width: 800, height: 600 }, [DISPLAY])).toBe(
			false,
		);
	});

	test("partly off-screen is accepted", () => {
		// 500 of its 800 points are still on the display the human dragged it against.
		expect(restorableFrame({ x: -300, y: 100, width: 800, height: 600 }, [DISPLAY])).toBe(true);
		expect(visibleOverlap({ x: -300, y: 100, width: 800, height: 600 }, DISPLAY)).toEqual({
			width: 500,
			height: 600,
		});
	});

	test("fits is accepted", () => {
		expect(restorableFrame({ x: 120, y: 80, width: 900, height: 640 }, [DISPLAY])).toBe(true);
	});

	test("a second display is enough, and no display rejects everything", () => {
		const left = { x: -1440, y: 0, width: 1440, height: 900 };
		const frame = { x: -1200, y: 100, width: 800, height: 600 };
		expect(restorableFrame(frame, [DISPLAY, left])).toBe(true);
		expect(restorableFrame(frame, [DISPLAY])).toBe(false);
		expect(restorableFrame(frame, [])).toBe(false);
	});

	test("a frame with no size or a non-finite number is rejected", () => {
		expect(restorableFrame({ x: 0, y: 0, width: 0, height: 600 }, [DISPLAY])).toBe(false);
		expect(restorableFrame({ x: Number.NaN, y: 0, width: 800, height: 600 }, [DISPLAY])).toBe(
			false,
		);
	});
});
