/**
 * `crust:window` through the two seams it actually meets: no adapter at all,
 * and the registry the bridge calls.
 *
 * Both are about honesty at a boundary — a platform with no AppKit answers a
 * structured `not-implemented` naming `NSWindow`, and the registry turns that
 * into a `CrustError` a page can catch. An adapted plugin, by contrast, resolves
 * every call as a value.
 */

import { describe, expect, test } from "bun:test";
import { isNotImplemented } from "./define";
import { PluginRegistry } from "./registry";
import { ctx, fakeAdapter } from "./window-fake.ts";
import { createWindowPlugin } from "./window.ts";

describe("no adapter", () => {
	test("every command answers a structured not-implemented naming NSWindow", () => {
		const plugin = createWindowPlugin();
		const results = [
			plugin.commands.create({ label: "second" }),
			plugin.commands.close({ label: "main" }),
			plugin.commands.focus({ label: "main" }),
			plugin.commands.setTitle({ label: "main", title: "x" }),
			plugin.commands.list(),
			plugin.commands.isOpen({ label: "main" }),
		];

		for (const result of results) {
			expect(isNotImplemented(result)).toBe(true);
			if (isNotImplemented(result)) expect(result.requires).toBe("NSWindow");
		}
	});

	test("the registry turns that into a not-implemented CrustError", async () => {
		const registry = new PluginRegistry().register(createWindowPlugin());
		await expect(registry.invoke("window", "list", {}, ctx)).rejects.toMatchObject({
			code: "not-implemented",
			requires: "NSWindow",
		});
	});
});

describe("through the registry", () => {
	test("an adapted plugin answers setTitle and isOpen as values", async () => {
		const adapter = fakeAdapter();
		const registry = new PluginRegistry().register(createWindowPlugin(adapter));

		expect(
			await registry.invoke("window", "setTitle", { label: "main", title: "From page" }, ctx),
		).toEqual({ ok: true, label: "main", title: "From page" });
		expect(await registry.invoke("window", "isOpen", { label: "main" }, ctx)).toEqual({
			ok: true,
			label: "main",
			open: true,
		});
		expect(await registry.invoke("window", "list", {}, ctx)).toEqual({
			ok: true,
			labels: ["main"],
		});

		// A dead command on an unknown label still resolves; only a missing
		// plugin or command is a rejection.
		expect(await registry.invoke("window", "focus", { label: "ghost" }, ctx)).toMatchObject({
			ok: false,
			code: "unknown-window",
		});
	});

	test("create reaches the adapter and the new label answers afterwards", async () => {
		const adapter = fakeAdapter(["main"]);
		const registry = new PluginRegistry().register(createWindowPlugin(adapter));

		expect(await registry.invoke("window", "create", { label: "second" }, ctx)).toEqual({
			ok: true,
			label: "second",
			created: true,
		});
		expect(await registry.invoke("window", "isOpen", { label: "second" }, ctx)).toEqual({
			ok: true,
			label: "second",
			open: true,
		});
		expect(await registry.invoke("window", "list", {}, ctx)).toEqual({
			ok: true,
			labels: ["main", "second"],
		});
	});
});
