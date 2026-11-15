/**
 * The frame setters through the plugin, on the fake adapter: a resize keeps the origin, a move keeps the size, and a negative origin is a real position rather than a refusal. The toggles are `window-state-flags.test.ts`; refusals in `window-state-refusals.test.ts`.
 */

import { describe, expect, test } from "bun:test";
import { fakeAdapter } from "./window-fake.ts";
import { createWindowPlugin } from "./window.ts";

describe("geometry", () => {
	test("a resize keeps the origin and a move keeps the size", () => {
		const adapter = fakeAdapter();
		const plugin = createWindowPlugin(adapter);

		expect(plugin.commands.getSize({ label: "main" })).toEqual({
			ok: true,
			label: "main",
			width: 800,
			height: 600,
		});
		expect(plugin.commands.setSize({ label: "main", width: 1024, height: 768 })).toEqual({
			ok: true,
			label: "main",
			width: 1024,
			height: 768,
		});
		expect(plugin.commands.getSize({ label: "main" })).toEqual({
			ok: true,
			label: "main",
			width: 1024,
			height: 768,
		});

		expect(plugin.commands.setPosition({ label: "main", x: 40, y: 60 })).toEqual({
			ok: true,
			label: "main",
			x: 40,
			y: 60,
		});
		expect(plugin.commands.getPosition({ label: "main" })).toEqual({
			ok: true,
			label: "main",
			x: 40,
			y: 60,
		});
		expect(plugin.commands.getSize({ label: "main" })).toEqual({
			ok: true,
			label: "main",
			width: 1024,
			height: 768,
		});
		expect(adapter.calls).toEqual(["setSize:main:1024x768", "setPosition:main:40,60"]);
	});

	test("a negative origin is a real position, not a refusal", () => {
		const plugin = createWindowPlugin(fakeAdapter());
		expect(plugin.commands.setPosition({ label: "main", x: -1200, y: -40 })).toEqual({
			ok: true,
			label: "main",
			x: -1200,
			y: -40,
		});
	});
});
