/**
 * `window.create`'s happy path and its two conflict cases.
 *
 * The point of the command is that after it answers, every other command finds
 * the new window by the same label — that is what makes a reopen possible
 * without keeping a hidden window alive. Argument validation and the
 * adapter-without-create gap are in `window-args.test.ts`.
 */

import { describe, expect, test } from "bun:test";
import { fakeAdapter } from "./window-fake.ts";
import { WindowAdapterError } from "./window-types.ts";
import { createWindowPlugin } from "./window.ts";

describe("window.create", () => {
	test("creates a window the other commands then find", () => {
		const adapter = fakeAdapter(["main"]);
		const plugin = createWindowPlugin(adapter);

		expect(
			plugin.commands.create({
				label: "prefs",
				title: "Preferences",
				width: 420,
				height: 280,
			}),
		).toEqual({ ok: true, label: "prefs", created: true });
		expect(adapter.calls).toEqual(["create:prefs:420x280:Preferences:-"]);

		expect(plugin.commands.list()).toEqual({ ok: true, labels: ["main", "prefs"] });
		expect(plugin.commands.isOpen({ label: "prefs" })).toEqual({
			ok: true,
			label: "prefs",
			open: true,
		});
		expect(plugin.commands.setTitle({ label: "prefs", title: "Renamed" })).toEqual({
			ok: true,
			label: "prefs",
			title: "Renamed",
		});
		expect(adapter.windows.get("prefs")?.title).toBe("Renamed");

		expect(plugin.commands.close({ label: "prefs" })).toEqual({
			ok: true,
			label: "prefs",
			closed: true,
		});
		expect(plugin.commands.isOpen({ label: "prefs" })).toEqual({
			ok: true,
			label: "prefs",
			open: false,
		});
	});

	test("a URL and no sizes cross the seam unchanged", () => {
		const adapter = fakeAdapter([]);
		const plugin = createWindowPlugin(adapter);

		expect(plugin.commands.create({ label: "docs", url: "https://example.com/docs" })).toEqual({
			ok: true,
			label: "docs",
			created: true,
		});
		// No width, height or title was invented: the platform's defaults are its
		// own, and a plugin that filled them in would silently override them.
		expect(adapter.calls).toEqual(["create:docs:-x-:-:https://example.com/docs"]);
	});

	test("a duplicate label is refused, names it, and never reaches the platform", () => {
		const adapter = fakeAdapter(["main"]);
		const plugin = createWindowPlugin(adapter);

		const result = plugin.commands.create({ label: "main" });
		expect(result).toMatchObject({ ok: false, code: "duplicate-label", label: "main" });
		if (!result.ok) expect(result.message).toContain('"main"');
		expect(adapter.calls).toEqual([]);
		expect(plugin.commands.list()).toEqual({ ok: true, labels: ["main"] });
	});

	/**
	 * The case only the platform can see: `DarwinPlatform` keeps a closed window
	 * addressable (`setReleasedWhenClosed: 0`), so a label it still holds refuses
	 * a re-create even though `windowLabels()` no longer lists it. The adapter
	 * throws the code; the plugin must not turn it into a bare handler-error.
	 */
	test("a label the adapter still holds is a duplicate, not a handler error", () => {
		const plugin = createWindowPlugin({
			create: (options) => {
				throw new WindowAdapterError(
					"duplicate-label",
					`crust: a window labelled ${JSON.stringify(options.label)} already exists`,
				);
			},
			close: () => {},
			focus: () => {},
			setTitle: () => {},
			list: () => [],
			isOpen: () => false,
		});

		const result = plugin.commands.create({ label: "prefs" });
		expect(result).toMatchObject({ ok: false, code: "duplicate-label", label: "prefs" });
		if (!result.ok) expect(result.message).toContain('"prefs"');
	});

	test("a create that does not track the label is an error, not a success", () => {
		const plugin = createWindowPlugin({
			create: (options) => ({ label: options.label }),
			close: () => {},
			focus: () => {},
			setTitle: () => {},
			list: () => [],
			isOpen: () => false,
		});

		expect(plugin.commands.create({ label: "ghost" })).toMatchObject({
			ok: false,
			code: "handler-error",
			label: "ghost",
		});
	});
});
