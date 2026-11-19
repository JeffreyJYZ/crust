/**
 * The console half: the page-world tap records from document start, and `testing.console` reads it
 * back. The tap's real home is the bridge's page script — this proves the same source records a
 * page's `console.log` and that a page without it answers `not-implemented` rather than `[]`.
 */

import { describe, expect, test } from "bun:test";

import { PAGE_CONSOLE_SOURCE } from "../bridge/page-console";
import { createTestingPlugin } from "./testing";
import { FakeDocument, fakeAdapter, installConsoleHook } from "./testing-fake";

describe("the page-world tap", () => {
	test("records a console.log with its level and text, and still calls the original", () => {
		const fake = fakeAdapter(new FakeDocument());
		installConsoleHook(fake);
		const page = fake.window as { __crustConsole?: { level: string; args: string[] }[] };
		fake.console.log("hello", 42);
		expect(fake.console.calls).toEqual([{ level: "log", args: ["hello", 42] }]);
		expect(page.__crustConsole?.map((entry) => [entry.level, entry.args])).toEqual([
			["log", ["hello", "42"]],
		]);
	});

	test("is idempotent: a second install keeps the first array", () => {
		const fake = fakeAdapter(new FakeDocument());
		installConsoleHook(fake);
		installConsoleHook(fake);
		fake.console.warn("once");
		const entries = (fake.window as { __crustConsole: unknown[] }).__crustConsole;
		expect(entries.length).toBe(1);
	});
});

describe("testing.console", () => {
	test("reads the captured entries back through the page", async () => {
		const fake = fakeAdapter(new FakeDocument());
		installConsoleHook(fake);
		fake.console.log("ready");
		fake.console.error("boom");
		const plugin = createTestingPlugin(fake.adapter);
		const answer = await plugin.commands.console({});
		expect("hooked" in answer && answer.hooked).toBe(true);
		expect(
			"entries" in answer && answer.entries.map((entry) => [entry.level, entry.args]),
		).toEqual([
			["log", ["ready"]],
			["error", ["boom"]],
		]);
	});

	test("`since` keeps only entries at or after the timestamp", async () => {
		const fake = fakeAdapter(new FakeDocument());
		installConsoleHook(fake);
		fake.console.log("old");
		const entries = (fake.window as { __crustConsole: { at: number }[] }).__crustConsole;
		const first = entries[0];
		// Moved far into the past rather than slept for: the filter is what is under test.
		if (first) first.at = 1;
		fake.console.log("new");
		const answer = await createTestingPlugin(fake.adapter).commands.console({ since: 1000 });
		expect("entries" in answer && answer.entries.map((entry) => entry.args[0])).toEqual([
			"new",
		]);
	});

	test("a page with no tap answers `not-implemented` naming the hook", async () => {
		const fake = fakeAdapter(new FakeDocument());
		const answer = await createTestingPlugin(fake.adapter).commands.console({});
		expect("code" in answer && answer.code).toBe("not-implemented");
		expect("requires" in answer && answer.requires).toContain("PAGE_CONSOLE_SOURCE");
	});

	test("the tap carries no token and no fetch, so the bridge's isolation is unchanged", () => {
		expect(PAGE_CONSOLE_SOURCE).toContain("__crustConsole");
		expect(PAGE_CONSOLE_SOURCE).not.toContain("token");
		expect(PAGE_CONSOLE_SOURCE).not.toContain("fetch");
		expect(PAGE_CONSOLE_SOURCE).not.toContain("authorization");
	});
});
