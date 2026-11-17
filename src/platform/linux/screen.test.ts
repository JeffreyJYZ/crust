/**
 * The Linux display list, driven through a fake symbol table: the arithmetic is what can be checked
 * off a display server, and `shim_screen_ready` is the answer that separates "this GDK cannot
 * enumerate" from "no display is connected" — two states a page must be able to tell apart.
 *
 * GTK3 has no `gdk_display_get_monitors`, which is why the shim uses the index-based pair; this
 * test is the shape and the numbers, not a claim that real GDK answers them.
 */

import { describe, expect, test } from "bun:test";
import type { LinuxShim } from "./shim-ffi.ts";
import { linuxScreenAdapter } from "./screen.ts";

/** A symbol table whose display answers are stated, so only the arithmetic varies. */
function fakeShim(count: number, rows: Float64Array[], ready = 1): LinuxShim {
	return {
		shim_screen_ready: () => ready,
		shim_screen_count: () => count,
		shim_screen_info: (index: number, out: Float64Array) => {
			const row = rows[index];
			if (row === undefined) return 0;
			out.set(row);
			return 1;
		},
	} as unknown as LinuxShim;
}

const PRIMARY = Float64Array.from([0, 0, 1920, 1080, 0, 27, 1920, 1053, 2, 1]);
const SECONDARY = Float64Array.from([1920, 0, 1440, 900, 1920, 0, 1440, 900, 1, 0]);

describe("the linux screen adapter", () => {
	test("answers every display GDK reported", () => {
		const adapter = linuxScreenAdapter(fakeShim(2, [PRIMARY, SECONDARY]));

		expect(adapter.list()).toEqual([
			{
				id: "0",
				primary: true,
				scale: 2,
				bounds: { x: 0, y: 0, width: 1920, height: 1080 },
				workArea: { x: 0, y: 27, width: 1920, height: 1053 },
			},
			{
				id: "1",
				primary: false,
				scale: 1,
				bounds: { x: 1920, y: 0, width: 1440, height: 900 },
				workArea: { x: 1920, y: 0, width: 1440, height: 900 },
			},
		]);
	});

	test("a GDK without the entry points answers an empty list, not a guess", () => {
		const adapter = linuxScreenAdapter(fakeShim(0, [], 0));
		expect(adapter.list()).toEqual([]);
	});

	test("a record refused mid-read is skipped rather than answered as a zero rectangle", () => {
		const adapter = linuxScreenAdapter(fakeShim(2, [PRIMARY]));
		expect(adapter.list()).toHaveLength(1);
	});

	test("a zero-size monitor is dropped", () => {
		const broken = Float64Array.from([0, 0, 0, 0, 0, 0, 0, 0, 1, 1]);
		const adapter = linuxScreenAdapter(fakeShim(1, [broken]));
		expect(adapter.list()).toEqual([]);
	});
});
