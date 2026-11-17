/**
 * `crust:theme` changes: the appearance a page applies, the `theme:changed` event that follows it, the
 * preference `"system"` handing control back, and the refusals — an appearance that is not one of the
 * three, and a plugin with no adapter emitting nothing at all.
 */

import { describe, expect, test } from "bun:test";
import { CrustError } from "@/bridge/errors";
import { call, fake, recorder, refusing } from "@/plugins/theme-fake";
import { createThemePlugin, THEME_CHANGED } from "@/plugins/theme";

describe("theme.set", () => {
	test("applies the appearance, reports it as an override, and emits theme:changed", () => {
		const { adapter, applied } = fake("dark");
		const plugin = createThemePlugin(adapter);
		const sink = recorder();

		const result = call(plugin, "set", { appearance: "light" }, sink.ctx);
		expect(result).toEqual({ ok: true, appearance: "light", source: "override" });
		expect(applied).toEqual(["light"]);
		expect(sink.events).toEqual([
			{ event: THEME_CHANGED, data: { appearance: "light", source: "override" } },
		]);
		// The plugin now answers from the same state it announced.
		expect(call(plugin, "current")).toEqual(result);
	});

	test("system hands the choice back, and the state is the system's again", () => {
		const { adapter, applied } = fake("dark");
		const plugin = createThemePlugin(adapter);
		const sink = recorder();

		call(plugin, "set", { appearance: "light" }, sink.ctx);
		expect(call(plugin, "set", { appearance: "system" }, sink.ctx)).toEqual({
			ok: true,
			appearance: "dark",
			source: "system",
		});
		expect(applied).toEqual(["light", "system"]);
		expect(sink.events.at(-1)).toEqual({
			event: THEME_CHANGED,
			data: { appearance: "dark", source: "system" },
		});
	});

	test("an appearance that is not one of the three is bad-request, and nothing is applied", () => {
		const { adapter, applied } = fake("dark");
		const plugin = createThemePlugin(adapter);
		expect(() => call(plugin, "set", { appearance: "sepia" }, recorder().ctx)).toThrow(
			CrustError,
		);
		expect(() => call(plugin, "set", {}, recorder().ctx)).toThrow(/light.*dark.*system/);
		expect(applied).toEqual([]);
	});

	test("an AppKit refusal is a typed handler-error, with no event and no override", () => {
		const { adapter, applied } = refusing("dark");
		const plugin = createThemePlugin(adapter);
		const sink = recorder();
		expect(call(plugin, "set", { appearance: "light" }, sink.ctx)).toEqual({
			ok: false,
			code: "handler-error",
			message: "NSApplication refused the appearance",
		});
		expect(applied).toEqual(["light"]);
		expect(sink.events).toEqual([]);
		expect(call(plugin, "current")).toEqual({ ok: true, appearance: "dark", source: "system" });
	});

	test("no adapter is not-implemented and emits nothing", () => {
		const sink = recorder();
		expect(call(createThemePlugin(), "set", { appearance: "light" }, sink.ctx)).toMatchObject({
			ok: false,
			code: "not-implemented",
		});
		expect(sink.events).toEqual([]);
	});
});

describe("theme.reset", () => {
	test("clears the override and emits the state the system put back", () => {
		const { adapter, applied } = fake("light");
		const plugin = createThemePlugin(adapter);
		const sink = recorder();

		call(plugin, "set", { appearance: "dark" }, sink.ctx);
		expect(call(plugin, "reset", undefined, sink.ctx)).toEqual({
			ok: true,
			appearance: "light",
			source: "system",
		});
		expect(applied).toEqual(["dark", "system"]);
		expect(sink.events.at(-1)).toEqual({
			event: THEME_CHANGED,
			data: { appearance: "light", source: "system" },
		});
	});

	test("an AppKit refusal on reset is a typed handler-error", () => {
		const { adapter } = refusing("light", "NSApplication refused the reset");
		const sink = recorder();
		expect(call(createThemePlugin(adapter), "reset", undefined, sink.ctx)).toEqual({
			ok: false,
			code: "handler-error",
			message: "NSApplication refused the reset",
		});
		expect(sink.events).toEqual([]);
	});

	test("no adapter is not-implemented", () => {
		expect(call(createThemePlugin(), "reset", undefined, recorder().ctx)).toMatchObject({
			ok: false,
			code: "not-implemented",
			requires: "NSAppearance",
		});
	});
});
