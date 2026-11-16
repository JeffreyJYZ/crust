import { describe, expect, test } from "bun:test";

import { CrustError } from "../bridge/errors.ts";
import { definePlugin } from "../plugins/define.ts";
import { RESERVED_EXTENSION_NAMES, defineExtension, isExtension } from "./define.ts";

type ExtensionArg = { name: string; commands: Record<string, () => number> };

describe("defineExtension", () => {
	test("is a frozen plugin with the extension brand", () => {
		const clock = defineExtension({ name: "clock", commands: { now: () => "now" } });
		expect(clock.name).toBe("clock");
		expect(clock.commands.now()).toBe("now");
		expect(isExtension(clock)).toBe(true);
		expect(Object.isFrozen(clock)).toBe(true);
		expect(Object.isFrozen(clock.commands)).toBe(true);
	});

	test("a plain plugin is never an extension", () => {
		const plugin = definePlugin({ name: "clock", commands: { now: () => "now" } });
		expect(isExtension(plugin)).toBe(false);
		expect(isExtension({ name: "clock", commands: { now: () => "now" } })).toBe(false);
		expect(isExtension(null)).toBe(false);
		expect(isExtension("clock")).toBe(false);
	});

	test("reuses definePlugin's refusals: a dot, no name, no commands, a non-function handler", () => {
		expect(() => defineExtension({ name: "a.b", commands: { x: () => 1 } })).toThrow(
			CrustError,
		);
		expect(() => defineExtension({ name: "", commands: { x: () => 1 } })).toThrow(/non-empty/);
		expect(() => defineExtension({ name: "empty", commands: {} })).toThrow(/no commands/);
		const badHandler = { name: "bad", commands: { x: 1 } } as unknown as ExtensionArg;
		expect(() => defineExtension(badHandler)).toThrow(/not a function/);
	});

	test("refuses a core plugin name, naming both sides", () => {
		for (const name of ["fs", "window", "app"]) {
			expect(() => defineExtension({ name, commands: { x: () => 1 } })).toThrow(CrustError);
		}
		expect(() => defineExtension({ name: "fs", commands: { x: () => 1 } })).toThrow(
			/extension "fs" collides with the core plugin "fs"/,
		);
		expect(RESERVED_EXTENSION_NAMES.has("fs")).toBe(true);
		expect(RESERVED_EXTENSION_NAMES.has("app")).toBe(true);
	});
});
