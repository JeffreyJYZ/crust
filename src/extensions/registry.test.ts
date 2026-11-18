import { describe, expect, test } from "bun:test";

import { defineExtension } from "./define.ts";
import { extensionRegistry } from "./registry.ts";

describe("extensionRegistry", () => {
	test("every build gets an empty registry that cannot leak into the next", () => {
		const first = extensionRegistry();
		const second = extensionRegistry();
		expect(first.size).toBe(0);

		const clock = defineExtension({ name: "clock", commands: { now: () => 1 } });
		first.register(clock);
		expect(first.has("clock")).toBe(true);
		expect(first.get("clock")).toBe(clock);

		// A registry is process state: sharing one would carry an extension from a previous build into
		// the next app and turn a duplicate name into a startup refusal.
		expect(second.size).toBe(0);
		expect(second.has("clock")).toBe(false);
	});
});
