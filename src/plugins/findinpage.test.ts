/**
 * `crust:findinpage` proofs that need no WebKit. Every test injects a fake adapter, so nothing here searches a real page or highlights anything on a machine someone is using.
 * What is proven is the contract: the argument checks that throw `bad-request`, the shape of every answer, the 0-or-1 `matches` WebKit's one BOOL allows, and the honest `not-implemented` for a clear with no public selector.
 */

import { describe, expect, test } from "bun:test";
import { CrustError } from "@/bridge/errors.ts";
import { isNotImplemented } from "@/plugins/define.ts";
import {
	createFindInPagePlugin,
	type FindAdapter,
	type FindOutcome,
	findinpagePlugin,
} from "@/plugins/findinpage.ts";

interface Recorded {
	adapter: FindAdapter;
	calls: string[];
	/** The queries the plugin handed the adapter, in order. */
	seen: Array<{ text: string; forward: boolean; matchCase: boolean }>;
}

/** A fake that records what it was asked and answers `answer`, or throws it. */
function fake(options: { answer?: FindOutcome; throws?: Error; clear?: boolean } = {}): Recorded {
	const calls: string[] = [];
	const seen: Array<{ text: string; forward: boolean; matchCase: boolean }> = [];
	const answer = options.answer ?? { matches: 1, found: true };
	const reply = (): FindOutcome => {
		if (options.throws) throw options.throws;
		return answer;
	};
	const adapter: FindAdapter = {
		search: async (query) => {
			calls.push("search");
			seen.push(query);
			return reply();
		},
		next: async () => {
			calls.push("next");
			return reply();
		},
		previous: async () => {
			calls.push("previous");
			return reply();
		},
	};
	if (options.clear) {
		adapter.clear = () => {
			calls.push("clear");
		};
	}
	return { adapter, calls, seen };
}

describe("findinpage plugin", () => {
	test("not-implemented without an adapter, naming the find selector", async () => {
		const plugin = createFindInPagePlugin();
		for (const result of [
			await plugin.commands.search({ text: "crust" }),
			await plugin.commands.next(undefined),
			await plugin.commands.previous(undefined),
		]) {
			expect(isNotImplemented(result)).toBe(true);
			if (isNotImplemented(result)) {
				expect(result.requires).toBe(
					"WKWebView -findString:withConfiguration:completionHandler:",
				);
			}
		}
	});

	test("the default registration is the adapter-less one", () => {
		expect(findinpagePlugin.name).toBe("findinpage");
		expect(typeof findinpagePlugin.commands.search).toBe("function");
	});

	test("a search forwards the text and the two defaults", async () => {
		const { adapter, seen } = fake();
		const result = await createFindInPagePlugin(adapter).commands.search({ text: "crust" });
		expect(result).toEqual({ ok: true, matches: 1, found: true });
		expect(seen).toEqual([{ text: "crust", forward: true, matchCase: false }]);
	});

	test("forward and matchCase reach the adapter when the caller sets them", async () => {
		const { adapter, seen } = fake();
		await createFindInPagePlugin(adapter).commands.search({
			text: "Crust",
			forward: false,
			matchCase: true,
		});
		expect(seen).toEqual([{ text: "Crust", forward: false, matchCase: true }]);
	});

	test("no match is found:false with matches 0, which is the only count WebKit gives", async () => {
		const { adapter } = fake({ answer: { matches: 0, found: false } });
		expect(await createFindInPagePlugin(adapter).commands.search({ text: "nope" })).toEqual({
			ok: true,
			matches: 0,
			found: false,
		});
	});

	test("next and previous ask the adapter and keep the same shape", async () => {
		const { adapter, calls } = fake({ answer: { matches: 1, found: true } });
		const plugin = createFindInPagePlugin(adapter);
		expect(await plugin.commands.next(undefined)).toEqual({
			ok: true,
			matches: 1,
			found: true,
		});
		expect(await plugin.commands.previous(undefined)).toEqual({
			ok: true,
			matches: 1,
			found: true,
		});
		expect(calls).toEqual(["next", "previous"]);
	});

	test("a rejected search is handler-error and keeps the adapter's message", async () => {
		const { adapter } = fake({
			throws: new Error("the find completion handler did not answer"),
		});
		expect(await createFindInPagePlugin(adapter).commands.search({ text: "crust" })).toEqual({
			ok: false,
			code: "handler-error",
			message: "the find completion handler did not answer",
		});
	});

	test("an empty text is bad-request and the adapter is never called", async () => {
		const { adapter, seen } = fake();
		const plugin = createFindInPagePlugin(adapter);
		await expect(plugin.commands.search({ text: "" })).rejects.toThrow(CrustError);
		await expect(plugin.commands.search({} as { text: string })).rejects.toThrow(
			'findinpage.search: "text" must be a non-empty string',
		);
		expect(seen).toEqual([]);
	});

	test("a non-boolean flag is bad-request, naming the field", async () => {
		const { adapter, seen } = fake();
		const plugin = createFindInPagePlugin(adapter);
		await expect(
			plugin.commands.search({ text: "crust", forward: 7 } as unknown as { text: string }),
		).rejects.toThrow('findinpage.search: "forward" must be a boolean');
		await expect(
			plugin.commands.search({ text: "crust", matchCase: "yes" } as unknown as {
				text: string;
			}),
		).rejects.toThrow('findinpage.search: "matchCase" must be a boolean');
		expect(seen).toEqual([]);
	});

	test("clear with no public selector is not-implemented, naming the private one", () => {
		const { adapter, calls } = fake();
		const result = createFindInPagePlugin(adapter).commands.clear(undefined);
		expect(isNotImplemented(result)).toBe(true);
		if (isNotImplemented(result))
			expect(result.requires).toBe("WKWebView -_clearFindIndicator");
		expect(calls).toEqual([]);
	});

	test("clear uses an adapter's own clear when the platform has one", () => {
		const { adapter, calls } = fake({ clear: true });
		expect(createFindInPagePlugin(adapter).commands.clear(undefined)).toEqual({
			ok: true,
			cleared: true,
		});
		expect(calls).toEqual(["clear"]);
	});
});
