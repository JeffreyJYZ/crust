/**
 * `windowSize` is the pure part of window creation: the clamp and the two minimums. Testing it
 * directly avoids launching AppKit while still proving both dimensions reach setContentMinSize.
 */
import { describe, expect, test } from "bun:test";
import { windowSize } from "./window-create.ts";

const fallback = { width: 1100, height: 760 };

describe("darwin window size", () => {
	test("clamps each dimension to its own configured minimum", () => {
		const size = windowSize(
			{ label: "main", width: 600, height: 400, minWidth: 800, minHeight: 600 },
			fallback,
		);
		expect(size).toEqual({ width: 800, height: 600, minWidth: 800, minHeight: 600 });
	});

	test("a size already above the minimum is left alone", () => {
		const size = windowSize(
			{ label: "main", width: 1200, height: 900, minWidth: 800, minHeight: 600 },
			fallback,
		);
		expect(size.width).toBe(1200);
		expect(size.height).toBe(900);
	});

	test("absent minimums are zero, the no-constraint value AppKit expects", () => {
		const size = windowSize({ label: "main" }, fallback);
		expect(size).toEqual({ width: 1100, height: 760, minWidth: 0, minHeight: 0 });
	});

	test("minHeight alone does not invent a width minimum", () => {
		const size = windowSize({ label: "main", minHeight: 500 }, fallback);
		expect(size.minWidth).toBe(0);
		expect(size.minHeight).toBe(500);
	});
});
