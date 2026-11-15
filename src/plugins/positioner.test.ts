/**
 * `positioner`'s nine placements against a stated screen frame and a fake window. The numbers are the test: a corner that used the wrong edge still answers `ok`, so only the exact point proves it read AppKit's bottom-left origin.
 */

import { expect, test } from "bun:test";

import {
	createPositionerPlugin,
	POSITIONER_PLACEMENTS,
	type PositionerNative,
	type ScreenBounds,
} from "./positioner.ts";
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
		topCenter: { x: 320, y: 300 },
		bottomCenter: { x: 320, y: 25 },
		leftCenter: { x: 0, y: 163 },
		rightCenter: { x: 640, y: 163 },
	} as const;

	expect(Object.keys(expected).sort()).toEqual([...POSITIONER_PLACEMENTS].sort());
	for (const [placement, point] of Object.entries(expected)) {
		const answer = await plugin.commands[placement as keyof typeof expected]({ label: "main" });
		expect(answer).toEqual({
			ok: true,
			label: "main",
			x: point.x,
			y: point.y,
			placed: true,
		});
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
	const plugin = createPositionerPlugin({
		native: adapter,
		screen: () => screen,
	});

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
	// The edge midpoints keep the overflow too: 1440 - 1600 halves to -80 on x,
	// 25 + 875 - 901 = -1 on top, and 25 + (875 - 901) / 2 = 12 on the mid y.
	const overflow = {
		topCenter: { x: -80, y: -1 },
		bottomCenter: { x: -80, y: 25 },
		leftCenter: { x: 0, y: 12 },
		rightCenter: { x: -160, y: 12 },
	} as const;
	for (const [placement, point] of Object.entries(overflow)) {
		const answer = await plugin.commands[placement as keyof typeof overflow]({ label: "main" });
		expect(answer).toMatchObject({ ok: true, x: point.x, y: point.y });
	}
});

test("a half point of slack rounds up, on either axis", async () => {
	// 401 - 300 = 101 of slack is 50.5, and 101 - 100 = 1 is 0.5: both round up
	// once, so a truncated answer would read 50 and 0 here.
	const adapter = fakeWindow({ width: 300, height: 100 });
	const plugin = createPositionerPlugin({
		native: adapter,
		screen: { x: 0, y: 0, width: 401, height: 101 },
	});

	expect(await plugin.commands.center({ label: "main" })).toMatchObject({ x: 51, y: 1 });
	const rounded = {
		topCenter: { x: 51, y: 1 },
		leftCenter: { x: 0, y: 1 },
		rightCenter: { x: 101, y: 1 },
	} as const;
	for (const [placement, point] of Object.entries(rounded)) {
		const answer = await plugin.commands[placement as keyof typeof rounded]({ label: "main" });
		expect(answer).toMatchObject({ ok: true, x: point.x, y: point.y });
	}
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
