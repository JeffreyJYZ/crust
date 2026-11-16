/**
 * `window.label` — the label the calling request carried, and the named refusal when it carried
 * none. The proof is that it never guesses: no adapter is consulted, so a request with no identity
 * is refused rather than answered with the first window, the focused one, or the only one.
 */

import { describe, expect, test } from "bun:test";
import { isNotImplemented, type PluginContext } from "@/plugins/define.ts";
import { fakeAdapter } from "@/plugins/window-fake.ts";
import { WINDOW_LABEL_REQUIRES } from "@/plugins/window-label.ts";
import { createWindowPlugin } from "@/plugins/window.ts";

/** The context the bridge builds for one request: the label it carried, if any. */
const ctx = (window?: string): PluginContext => ({ emit: () => {}, window });

describe("window.label", () => {
	test("answers the label the request carried", () => {
		const plugin = createWindowPlugin(fakeAdapter(["main", "inspector"]));
		expect(plugin.commands.label({}, ctx("inspector"))).toEqual({
			ok: true,
			label: "inspector",
		});
	});

	test("a request with no identity is not-implemented, naming what is missing", () => {
		const answer = createWindowPlugin(fakeAdapter()).commands.label({}, ctx());
		expect(isNotImplemented(answer)).toBe(true);
		if (!isNotImplemented(answer)) throw new Error("expected not-implemented");
		expect(answer.requires).toBe(WINDOW_LABEL_REQUIRES);
		expect(answer.message).toContain("no window identity");
	});

	test("never reads the adapter: the platform knows which windows exist, not which one asked", () => {
		const adapter = fakeAdapter(["main", "inspector"]);
		const plugin = createWindowPlugin(adapter);
		plugin.commands.label({}, ctx("main"));
		plugin.commands.label({}, ctx());
		expect(adapter.calls).toEqual([]);
	});

	test("answers the same refusal with no adapter at all, not an NSWindow gap", () => {
		const answer = createWindowPlugin().commands.label({}, ctx());
		expect(isNotImplemented(answer)).toBe(true);
		if (!isNotImplemented(answer)) throw new Error("expected not-implemented");
		expect(answer.requires).toBe(WINDOW_LABEL_REQUIRES);
		expect(answer.message).not.toContain("NSWindow");
	});

	test("a blank or non-string label is no identity, not a window called ''", () => {
		const plugin = createWindowPlugin(fakeAdapter(["main"]));
		expect(isNotImplemented(plugin.commands.label({}, ctx("   ")))).toBe(true);
		expect(
			isNotImplemented(plugin.commands.label({}, { emit: () => {}, window: 7 } as never)),
		).toBe(true);
	});
});
