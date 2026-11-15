/**
 * The state toggles through the plugin, on the fake adapter: always-on-top, fullscreen, minimize, unminimize and maximize each answer the state that follows, and the next read agrees. The frame setters are `window-state-geometry.test.ts`; refusals in `window-state-refusals.test.ts`.
 */

import { describe, expect, test } from "bun:test";
import { fakeAdapter } from "./window-fake.ts";
import { createWindowPlugin } from "./window.ts";

describe("flags", () => {
	test("always-on-top reads back what was set", () => {
		const plugin = createWindowPlugin(fakeAdapter());
		expect(plugin.commands.isAlwaysOnTop({ label: "main" })).toEqual({
			ok: true,
			label: "main",
			alwaysOnTop: false,
		});
		expect(plugin.commands.setAlwaysOnTop({ label: "main", value: true })).toEqual({
			ok: true,
			label: "main",
			alwaysOnTop: true,
		});
		expect(plugin.commands.isAlwaysOnTop({ label: "main" })).toEqual({
			ok: true,
			label: "main",
			alwaysOnTop: true,
		});
	});

	test("fullscreen round-trips", () => {
		const plugin = createWindowPlugin(fakeAdapter());
		expect(plugin.commands.setFullscreen({ label: "main", value: true })).toEqual({
			ok: true,
			label: "main",
			fullscreen: true,
		});
		expect(plugin.commands.isFullscreen({ label: "main" })).toEqual({
			ok: true,
			label: "main",
			fullscreen: true,
		});
	});

	test("minimize, unminimize, maximize and their reads agree", () => {
		const adapter = fakeAdapter();
		const plugin = createWindowPlugin(adapter);

		expect(plugin.commands.isMinimized({ label: "main" })).toEqual({
			ok: true,
			label: "main",
			minimized: false,
		});
		expect(plugin.commands.minimize({ label: "main" })).toEqual({
			ok: true,
			label: "main",
			minimized: true,
		});
		expect(plugin.commands.isMinimized({ label: "main" })).toEqual({
			ok: true,
			label: "main",
			minimized: true,
		});
		expect(plugin.commands.unminimize({ label: "main" })).toEqual({
			ok: true,
			label: "main",
			minimized: false,
		});

		expect(plugin.commands.maximize({ label: "main" })).toEqual({
			ok: true,
			label: "main",
			maximized: true,
		});
		expect(plugin.commands.isMaximized({ label: "main" })).toEqual({
			ok: true,
			label: "main",
			maximized: true,
		});
		expect(adapter.calls).toEqual(["minimize:main", "unminimize:main", "maximize:main"]);
	});
});
