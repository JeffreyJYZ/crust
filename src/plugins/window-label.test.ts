/**
 * `window.label` — the one command that answers a refusal on purpose.
 * The proof is that it never guesses: it does not read the adapter, does not answer the first
 * window, and does not answer the focused one, because the bridge never learned which window a
 * request came from. It names what is missing instead, so a page that needs its identity is told
 * why it cannot have one rather than handed a wrong label.
 */

import { describe, expect, test } from "bun:test";
import { isNotImplemented } from "@/plugins/define.ts";
import { fakeAdapter } from "@/plugins/window-fake.ts";
import { createWindowPlugin, WINDOW_LABEL_REQUIRES } from "@/plugins/window.ts";

describe("window.label", () => {
	test("answers not-implemented naming the missing per-window identity", () => {
		const plugin = createWindowPlugin(fakeAdapter(["main", "inspector"]));
		const answer = plugin.commands.label();
		expect(isNotImplemented(answer)).toBe(true);
		if (!isNotImplemented(answer)) throw new Error("expected not-implemented");
		expect(answer.requires).toBe(WINDOW_LABEL_REQUIRES);
		expect(answer.message).toContain("no window identity");
	});

	test("names the workaround instead of leaving the page stuck", () => {
		const answer = createWindowPlugin(fakeAdapter()).commands.label();
		if (!isNotImplemented(answer)) throw new Error("expected not-implemented");
		expect(answer.message).toContain("Read the label from the URL");
		expect(answer.message).toContain("pass it explicitly");
	});

	test("never reads the adapter: no platform can supply what the bridge never saw", () => {
		const adapter = fakeAdapter(["main", "inspector"]);
		createWindowPlugin(adapter).commands.label();
		expect(adapter.calls).toEqual([]);
	});

	test("answers the same refusal with no adapter at all, not an NSWindow gap", () => {
		const answer = createWindowPlugin().commands.label();
		expect(isNotImplemented(answer)).toBe(true);
		if (!isNotImplemented(answer)) throw new Error("expected not-implemented");
		expect(answer.requires).toBe(WINDOW_LABEL_REQUIRES);
		expect(answer.message).not.toContain("NSWindow");
	});
});
