/**
 * The state commands' refusal side: a bad payload never reaches the adapter, an unknown label is `unknown-window` whatever the value was, and an adapter that predates the command answers `unknown-adapter` instead of failing to compile or pretending. Happy path in `window-state.test.ts`.
 */

import { describe, expect, test } from "bun:test";
import { fakeAdapter } from "./window-fake.ts";
import { createWindowPlugin } from "./window.ts";

describe("invalid payloads", () => {
	test("a size, a position and a flag are validated, never coerced", () => {
		const adapter = fakeAdapter();
		const plugin = createWindowPlugin(adapter);
		const bad = (value: unknown) => value as never;

		for (const size of [0, -1, 12.5, Number.NaN, "900", null, undefined]) {
			expect(
				plugin.commands.setSize(bad({ label: "main", width: size, height: 600 })),
			).toMatchObject({ ok: false, code: "invalid-size" });
			expect(
				plugin.commands.setSize(bad({ label: "main", width: 800, height: size })),
			).toMatchObject({ ok: false, code: "invalid-size" });
		}

		for (const point of [1.5, Number.NaN, "40", null, undefined]) {
			expect(
				plugin.commands.setPosition(bad({ label: "main", x: point, y: 0 })),
			).toMatchObject({ ok: false, code: "invalid-position" });
		}

		for (const value of ["false", 1, null, undefined]) {
			expect(plugin.commands.setAlwaysOnTop(bad({ label: "main", value }))).toMatchObject({
				ok: false,
				code: "invalid-value",
			});
			expect(plugin.commands.setFullscreen(bad({ label: "main", value }))).toMatchObject({
				ok: false,
				code: "invalid-value",
			});
		}

		// Nothing invalid reached the platform, so no window moved and no flag flipped.
		expect(adapter.calls).toEqual([]);
	});
});

describe("labels and adapters", () => {
	test("an unknown label is unknown-window whatever the payload held", () => {
		const plugin = createWindowPlugin(fakeAdapter());
		expect(plugin.commands.setSize({ label: "ghost", width: 10, height: 10 })).toMatchObject({
			ok: false,
			code: "unknown-window",
			label: "ghost",
		});
		expect(plugin.commands.isFullscreen({ label: "ghost" })).toMatchObject({
			ok: false,
			code: "unknown-window",
		});
	});

	test("an adapter that predates the command answers unknown-adapter", () => {
		const plugin = createWindowPlugin({
			close: () => {},
			focus: () => {},
			setTitle: () => {},
			list: () => ["main"],
			isOpen: () => true,
		});
		expect(plugin.commands.setSize({ label: "main", width: 10, height: 10 })).toMatchObject({
			ok: false,
			code: "unknown-adapter",
		});
		expect(plugin.commands.maximize({ label: "main" })).toMatchObject({
			ok: false,
			code: "unknown-adapter",
		});
	});
});
