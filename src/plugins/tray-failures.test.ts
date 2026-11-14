/**
 * `crust:tray`'s refusal side: typed failures, the adapter-less answers and the
 * registry seam.
 *
 * A page must always get a shape it can branch on — a bad argument is its own
 * code, a partial adapter is `unknown-adapter` rather than a `TypeError`, and a
 * platform with no `NSStatusBar` answers a structured `not-implemented` that the
 * registry turns into a `CrustError`.
 */

import { describe, expect, test } from "bun:test";
import { isNotImplemented } from "./define";
import { PluginRegistry } from "./registry";
import { fakeAdapter } from "./tray-fake.ts";
import { createTrayPlugin, type TrayMenuItem, TrayAdapterError, type TrayNative } from "./tray.ts";

describe("typed failures", () => {
	test("a missing or non-string title is its own typed failure", () => {
		const plugin = createTrayPlugin(fakeAdapter());

		expect(plugin.commands.setTitle({} as { text: string })).toMatchObject({
			ok: false,
			code: "invalid-text",
		});
		expect(plugin.commands.setTitle({ text: 7 } as unknown as { text: string })).toMatchObject({
			ok: false,
			code: "invalid-text",
		});
	});

	test("a malformed menu is an invalid-menu failure at the first bad row", () => {
		const plugin = createTrayPlugin(fakeAdapter());

		expect(plugin.commands.setMenu({} as { items: [] })).toMatchObject({
			ok: false,
			code: "invalid-menu",
		});
		expect(
			plugin.commands.setMenu({ items: "nope" } as unknown as { items: [] }),
		).toMatchObject({ ok: false, code: "invalid-menu" });
		expect(plugin.commands.setMenu({ items: [{ label: "" }] })).toMatchObject({
			ok: false,
			code: "invalid-menu",
		});
		expect(plugin.commands.setMenu({ items: [{} as { label: string }] })).toMatchObject({
			ok: false,
			code: "invalid-menu",
		});
		expect(
			plugin.commands.setMenu({
				items: [{ label: "x", onClick: 7 } as unknown as TrayMenuItem],
			}),
		).toMatchObject({ ok: false, code: "invalid-menu" });
	});

	test("an adapter that throws is a typed value, not a propagated error", () => {
		const plugin = createTrayPlugin({
			setTitle: () => {
				throw new TrayAdapterError("destroyed", "status item is gone");
			},
			setMenu: () => {},
			show: () => {},
			hide: () => {},
			destroy: () => {
				throw new Error("boom");
			},
		});

		expect(plugin.commands.setTitle({ text: "x" })).toMatchObject({
			ok: false,
			code: "destroyed",
			message: "status item is gone",
		});
		expect(plugin.commands.destroy()).toMatchObject({
			ok: false,
			code: "handler-error",
			message: "boom",
		});
	});

	test("a partial adapter is an unknown-adapter failure, not a TypeError", () => {
		const plugin = createTrayPlugin({ setTitle: () => {} } as unknown as TrayNative);
		expect(plugin.commands.show()).toMatchObject({ ok: false, code: "unknown-adapter" });
		expect(plugin.commands.hide()).toMatchObject({ ok: false, code: "unknown-adapter" });
		expect(plugin.commands.setMenu({ items: [] })).toMatchObject({
			ok: false,
			code: "unknown-adapter",
		});
	});
});

describe("no adapter", () => {
	test("every command answers a structured not-implemented naming NSStatusBar", () => {
		const plugin = createTrayPlugin();
		const results = [
			plugin.commands.setTitle({ text: "x" }),
			plugin.commands.setMenu({ items: [{ label: "Open" }] }),
			plugin.commands.show(),
			plugin.commands.hide(),
			plugin.commands.destroy(),
		];

		for (const result of results) {
			expect(isNotImplemented(result)).toBe(true);
			if (isNotImplemented(result)) expect(result.requires).toBe("NSStatusBar");
		}
	});

	test("the registry turns that into a not-implemented CrustError", async () => {
		const registry = new PluginRegistry().register(createTrayPlugin());
		await expect(registry.invoke("tray", "show", {}, { emit: () => {} })).rejects.toMatchObject(
			{ code: "not-implemented", requires: "NSStatusBar" },
		);
	});
});

describe("through the registry", () => {
	test("an adapted plugin answers values a page can branch on", async () => {
		const adapter = fakeAdapter();
		const registry = new PluginRegistry().register(createTrayPlugin(adapter));
		const ctx = { emit: () => {} };

		expect(await registry.invoke("tray", "setTitle", { text: "From page" }, ctx)).toEqual({
			ok: true,
			text: "From page",
		});
		expect(await registry.invoke("tray", "show", {}, ctx)).toEqual({ ok: true, active: true });

		// A dead command on a bad argument resolves a value; only a missing
		// plugin, command or adapter is a rejection.
		expect(await registry.invoke("tray", "setTitle", { text: 1 }, ctx)).toMatchObject({
			ok: false,
			code: "invalid-text",
		});
	});
});
