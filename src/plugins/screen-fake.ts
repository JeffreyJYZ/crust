/**
 * The screen plugin's test double: a stated set of displays, imported only by tests. `screen.ts`
 * has no knowledge of it, and it lives apart so the numbers a test asserts are visible in one place
 * instead of rebuilt in each case.
 */

import type { ScreenAdapter, ScreenBounds, ScreenRecord } from "./screen.ts";

/** A 1440×900 primary above a 25-point menu bar, the shape `-[NSScreen frame]` answers. */
export const PRIMARY_BOUNDS: ScreenBounds = { x: 0, y: 0, width: 1440, height: 900 };

/** The same display's usable area: the menu bar at the top and a 60-point Dock at the bottom. */
export const PRIMARY_WORK: ScreenBounds = { x: 0, y: 25, width: 1440, height: 815 };

/** A 1920×1080 Retina display to the right of the primary, in top-left page pixels. */
export const SECONDARY_BOUNDS: ScreenBounds = { x: 1440, y: -180, width: 1920, height: 1080 };

export const SECONDARY_WORK: ScreenBounds = { x: 1440, y: -180, width: 1920, height: 1080 };

export const PRIMARY: ScreenRecord = {
	id: "0",
	primary: true,
	scale: 2,
	bounds: PRIMARY_BOUNDS,
	workArea: PRIMARY_WORK,
};

export const SECONDARY: ScreenRecord = {
	id: "1",
	primary: false,
	scale: 1,
	bounds: SECONDARY_BOUNDS,
	workArea: SECONDARY_WORK,
};

/** An adapter over a stated list, recording how many times it was asked. */
export function fakeScreens(
	records: readonly ScreenRecord[] = [PRIMARY, SECONDARY],
): ScreenAdapter & { reads: () => number } {
	let reads = 0;
	return {
		list: () => {
			reads++;
			return records.map((record) => ({ ...record }));
		},
		reads: () => reads,
	};
}
