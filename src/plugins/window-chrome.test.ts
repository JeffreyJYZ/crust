/**
 * The chrome commands through the plugin, on the fake adapter: the title bar and the opacity round-trip on their window, and the pointer is app-wide and round-trips on its own. Every bad payload and every missing adapter member is a typed refusal in `window-chrome-refusals.test.ts`.
 */

import { describe, expect, test } from "bun:test";
import { fakeAdapter } from "./window-fake.ts";
import { createWindowPlugin } from "./window.ts";

describe("title bar and opacity", () => {
	test("decorations round-trip per window", () => {
		const adapter = fakeAdapter(["main", "prefs"]);
		const plugin = createWindowPlugin(adapter);

		expect(plugin.commands.isDecorated({ label: "main" })).toEqual({
			ok: true,
			label: "main",
			decorations: true,
		});
		expect(plugin.commands.setDecorations({ label: "main", value: false })).toEqual({
			ok: true,
			label: "main",
			decorations: false,
		});
		expect(plugin.commands.isDecorated({ label: "main" })).toEqual({
			ok: true,
			label: "main",
			decorations: false,
		});
		// The other window is untouched: this is per-window state, not the app's.
		expect(plugin.commands.isDecorated({ label: "prefs" })).toEqual({
			ok: true,
			label: "prefs",
			decorations: true,
		});
		expect(adapter.calls).toEqual(["setDecorations:main:false"]);
	});

	test("opacity round-trips, and both ends of 0–1 are legal", () => {
		const adapter = fakeAdapter();
		const plugin = createWindowPlugin(adapter);

		expect(plugin.commands.opacity({ label: "main" })).toEqual({
			ok: true,
			label: "main",
			opacity: 1,
		});
		expect(plugin.commands.setOpacity({ label: "main", value: 0.4 })).toEqual({
			ok: true,
			label: "main",
			opacity: 0.4,
		});
		expect(plugin.commands.opacity({ label: "main" })).toEqual({
			ok: true,
			label: "main",
			opacity: 0.4,
		});

		expect(plugin.commands.setOpacity({ label: "main", value: 0 }).ok).toBe(true);
		expect(plugin.commands.setOpacity({ label: "main", value: 1 }).ok).toBe(true);
		expect(adapter.calls).toEqual([
			"setOpacity:main:0.4",
			"setOpacity:main:0",
			"setOpacity:main:1",
		]);
	});
});

describe("the pointer", () => {
	test("every cursor name reaches the adapter and round-trips", () => {
		const adapter = fakeAdapter();
		const plugin = createWindowPlugin(adapter);

		for (const cursor of ["default", "pointer", "crosshair", "text", "grab"] as const) {
			expect(plugin.commands.setCursor({ cursor })).toEqual({ ok: true, cursor });
			expect(adapter.pointer().cursor).toBe(cursor);
		}
		expect(adapter.calls).toEqual([
			"setCursor:default",
			"setCursor:pointer",
			"setCursor:crosshair",
			"setCursor:text",
			"setCursor:grab",
		]);
	});

	test("visibility is a flag, and the fake never touches a real cursor", () => {
		const adapter = fakeAdapter();
		const plugin = createWindowPlugin(adapter);

		expect(plugin.commands.setCursorVisible({ value: false })).toEqual({
			ok: true,
			visible: false,
		});
		expect(adapter.pointer().visible).toBe(false);
		expect(plugin.commands.setCursorVisible({ value: true })).toEqual({
			ok: true,
			visible: true,
		});
		expect(adapter.pointer().visible).toBe(true);
		expect(adapter.calls).toEqual(["setCursorVisible:false", "setCursorVisible:true"]);
	});
});
