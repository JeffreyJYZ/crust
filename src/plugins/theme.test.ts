/**
 * `crust:theme` reads: what the app draws in, that the value comes from the adapter rather than a
 * constant, and the honest `not-implemented` of a plugin with no AppKit. The changes and their events
 * live in `theme-set.test.ts`.
 */

import { describe, expect, test } from "bun:test";
import { call, fake } from "@/plugins/theme-fake";
import { createThemePlugin } from "@/plugins/theme";

describe("theme.current", () => {
	test("reports the system's appearance as the source while no page asked for one", () => {
		const { adapter } = fake("dark");
		expect(call(createThemePlugin(adapter), "current")).toEqual({
			ok: true,
			appearance: "dark",
			source: "system",
		});
	});

	test("a light system reports light, so nothing is hardcoded", () => {
		const { adapter } = fake("light");
		expect(call(createThemePlugin(adapter), "current")).toEqual({
			ok: true,
			appearance: "light",
			source: "system",
		});
	});

	test("no adapter is not-implemented, naming NSAppearance", () => {
		expect(call(createThemePlugin(), "current")).toMatchObject({
			ok: false,
			code: "not-implemented",
			requires: "NSAppearance",
		});
	});
});
