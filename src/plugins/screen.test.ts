/**
 * `crust:screen` — every display, its bounds, its work area and which one is primary. The numbers
 * are the test: a record whose `bounds` and `workArea` were swapped still answers `ok`, so only the
 * exact rectangles prove the halves are distinct.
 */

import { expect, test } from "bun:test";
import { createScreenPlugin, type ScreenRecord, SCREEN_COMMANDS } from "./screen.ts";
import { fakeScreens, PRIMARY, PRIMARY_WORK, SECONDARY } from "./screen-fake.ts";

test("list answers every display, in the order the platform reported them", async () => {
	const plugin = createScreenPlugin({ list: fakeScreens().list });

	const answer = await plugin.commands.list();

	expect(answer).toEqual({ ok: true, screens: [PRIMARY, SECONDARY] });
});

test("bounds and work area stay distinct: a swapped pair fails here", async () => {
	const plugin = createScreenPlugin({ list: fakeScreens([PRIMARY]).list });

	const answer = await plugin.commands.list();
	if (!("screens" in answer)) throw new Error("list refused");

	const [first] = answer.screens;
	expect(first?.bounds).toEqual({ x: 0, y: 0, width: 1440, height: 900 });
	expect(first?.workArea).toEqual(PRIMARY_WORK);
	// The dock's 60 points and the menu bar's 25 make the two rectangles different in height.
	expect(first?.bounds.height).not.toBe(first?.workArea.height);
});

test("primary answers the display the platform marks, not merely the first", async () => {
	// The secondary is listed first on purpose: a plugin taking `[0]` would pass a primary-first
	// list and answer the wrong screen here.
	const plugin = createScreenPlugin({ list: fakeScreens([SECONDARY, PRIMARY]).list });

	const answer = await plugin.commands.primary();

	expect(answer).toEqual({ ok: true, screen: PRIMARY });
	expect(SCREEN_COMMANDS).toEqual(["list", "primary"]);
});

test("primary falls back to the first display when none is marked", async () => {
	const unmarked: ScreenRecord = { ...PRIMARY, primary: false };
	const plugin = createScreenPlugin({ list: fakeScreens([unmarked]).list });

	expect(await plugin.commands.primary()).toEqual({ ok: true, screen: unmarked });
});

test("a display with unusable bounds is dropped rather than answered as a zero rectangle", async () => {
	const empty: ScreenRecord = {
		...SECONDARY,
		bounds: { x: 0, y: 0, width: 0, height: 0 },
	};
	const plugin = createScreenPlugin({ list: fakeScreens([empty, PRIMARY]).list });

	const answer = await plugin.commands.list();
	if (!("screens" in answer)) throw new Error("list refused");

	expect(answer.screens).toEqual([PRIMARY]);
});

test("the adapter is asked on every call, so a display change is picked up", async () => {
	let records: ScreenRecord[] = [PRIMARY];
	const adapter = {
		list: () => records,
	};
	const plugin = createScreenPlugin(adapter);

	await plugin.commands.list();
	records = [PRIMARY, SECONDARY];
	const answer = await plugin.commands.list();
	if (!("screens" in answer)) throw new Error("list refused");

	expect(answer.screens).toHaveLength(2);
});

test("no adapter is not-implemented on both commands, naming NSScreen", async () => {
	const plugin = createScreenPlugin();

	for (const command of SCREEN_COMMANDS) {
		expect(await plugin.commands[command]()).toMatchObject({
			ok: false,
			code: "not-implemented",
			requires: "NSScreen",
		});
	}
});

test("an empty list is a real answer, and primary names the missing display", async () => {
	const plugin = createScreenPlugin({ list: fakeScreens([]).list });

	expect(await plugin.commands.list()).toEqual({ ok: true, screens: [] });
	expect(await plugin.commands.primary()).toMatchObject({
		ok: false,
		code: "handler-error",
		message: expect.stringContaining("no usable display"),
	});
});

test("a record missing an id or a scale is still usable, with the edges defaulted", async () => {
	const partial = {
		primary: true,
		bounds: PRIMARY.bounds,
		workArea: PRIMARY.workArea,
	} as unknown as ScreenRecord;
	const plugin = createScreenPlugin({ list: fakeScreens([partial]).list });

	const answer = await plugin.commands.list();
	if (!("screens" in answer)) throw new Error("list refused");

	expect(answer.screens[0]).toEqual({
		id: "0",
		primary: true,
		scale: 1,
		bounds: PRIMARY.bounds,
		workArea: PRIMARY.workArea,
	});
});
