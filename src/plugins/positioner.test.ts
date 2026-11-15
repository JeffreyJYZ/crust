/**
 * `positioner`'s five placements against a stated screen frame and a fake window. The numbers are the test: a corner that used the wrong edge still answers `ok`, so only the exact point proves it read AppKit's bottom-left origin.
 */

import { expect, test } from "bun:test";

import { createPositionerPlugin, type PositionerNative, type ScreenBounds } from "./positioner.ts";
import { WindowAdapterError } from "./window-types.ts";

/** A 1440×875 visible frame above a 25-point dock, the shape `-[NSScreen visibleFrame]` answers. */
const SCREEN: ScreenBounds = { x: 0, y: 25, width: 1440, height: 875 };

function fakeWindow(size: { width: number; height: number }, labels: string[] = ["main"]) {
	const placed: { x: number; y: number }[] = [];
	return {
		placed,
		list: () => [...labels],
		getSize: (label: string) => {
			if (!labels.includes(label)) {
				throw new WindowAdapterError("unknown-window", `no window labelled ${label}`);
			}
			return { ...size };
		},
		setPosition: (_label: string, position: { x: number; y: number }) => {
			placed.push(position);
		},
	};
}

test("every placement lands on its own point of the visible frame", async () => {
	const adapter = fakeWindow({ width: 800, height: 600 });
	const plugin = createPositionerPlugin({ native: adapter, screen: SCREEN });

	// 875 - 600 = 275 of slack vertically, 1440 - 800 = 640 horizontally.
	const expected = {
		center: { x: 320, y: 163 },
		topLeft: { x: 0, y: 300 },
		topRight: { x: 640, y: 300 },
		bottomLeft: { x: 0, y: 25 },
		bottomRight: { x: 640, y: 25 },
	} as const;

	for (const [corner, point] of Object.entries(expected)) {
		const answer = await plugin.commands[corner as keyof typeof expected]({ label: "main" });
		expect(answer).toEqual({ ok: true, label: "main", x: point.x, y: point.y, placed: true });
	}
	expect(adapter.placed).toEqual(Object.values(expected));
});

test("the window is moved once per command, never resized", async () => {
	const adapter = fakeWindow({ width: 300, height: 200 });
	const plugin = createPositionerPlugin({ native: adapter, screen: SCREEN });

	await plugin.commands.center({ label: "main" });

	expect(adapter.placed).toEqual([{ x: 570, y: 363 }]);
});

test("a screen reader is asked on every call, so a display change is picked up", async () => {
	let screen: ScreenBounds = { x: 0, y: 0, width: 1000, height: 800 };
	const adapter = fakeWindow({ width: 200, height: 100 });
	const plugin = createPositionerPlugin({ native: adapter, screen: () => screen });

	await plugin.commands.topRight({ label: "main" });
	screen = { x: 100, y: 50, width: 400, height: 300 };
	await plugin.commands.topRight({ label: "main" });

	expect(adapter.placed).toEqual([
		{ x: 800, y: 700 },
		{ x: 300, y: 250 },
	]);
});

test("a window wider than the screen keeps a negative offset rather than being clamped", async () => {
	// 1440 - 1600 is negative, and 875 - 901 is negative: a centre that clamped
	// to 0 would answer 0,0 and look just as successful.
	const adapter = fakeWindow({ width: 1600, height: 901 });
	const plugin = createPositionerPlugin({ native: adapter, screen: SCREEN });

	expect(await plugin.commands.center({ label: "main" })).toEqual({
		ok: true,
		label: "main",
		x: -80,
		y: 12,
		placed: true,
	});
});

test("no usable screen frame is unknown-adapter, and nothing moves", async () => {
	const adapter = fakeWindow({ width: 800, height: 600 });

	for (const screen of [undefined, { x: 0, y: 0, width: 0, height: 0 }]) {
		const plugin = createPositionerPlugin({ native: adapter, screen });
		expect(await plugin.commands.center({ label: "main" })).toMatchObject({
			ok: false,
			code: "unknown-adapter",
			label: "main",
		});
	}
	expect(adapter.placed).toEqual([]);
});

test("an unknown label names the window before the screen is consulted", async () => {
	const adapter = fakeWindow({ width: 800, height: 600 });
	const plugin = createPositionerPlugin({ native: adapter, screen: SCREEN });

	expect(await plugin.commands.topLeft({ label: "prefs" })).toEqual({
		ok: false,
		code: "unknown-window",
		message: 'crust: no window labelled "prefs"',
		label: "prefs",
	});
});

test("no adapter is not-implemented", async () => {
	const plugin = createPositionerPlugin({ screen: SCREEN });

	expect(await plugin.commands.bottomRight({ label: "main" })).toMatchObject({
		ok: false,
		code: "not-implemented",
		requires: "NSWindow",
	});
});

test("an adapter without setPosition is unknown-adapter, not a crash", async () => {
	// `setPosition` lands in a sibling lane, so this partial adapter is a real
	// intermediate state rather than a hypothetical.
	const partial = {
		list: () => ["main"],
		getSize: () => ({ width: 800, height: 600 }),
	} as unknown as PositionerNative;
	const plugin = createPositionerPlugin({ native: partial, screen: SCREEN });

	expect(await plugin.commands.center({ label: "main" })).toMatchObject({
		ok: false,
		code: "unknown-adapter",
		label: "main",
	});
});
