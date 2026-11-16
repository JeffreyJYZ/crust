/**
 * `crust:findinpage` aimed at a named window. Same proof as the navigation suite: the resolver
 * the app wires (`webviewResolver`) over two fake webviews, so a search that landed on the wrong
 * window would answer the other window's outcome.
 * No page is searched and no highlight is drawn; every test injects a fake adapter.
 */

import { describe, expect, test } from "bun:test";
import { CrustError } from "@/bridge/errors.ts";
import {
	createFindInPagePlugin,
	type FindAdapter,
	type FindOutcome,
	type FindQuery,
} from "@/plugins/findinpage.ts";
import { webviewResolver } from "@/platform/darwin/webview-target.ts";

const VIEWS: Record<string, number> = { main: 11, inspector: 22 };

interface Recorded {
	adapter: FindAdapter;
	/** What the adapter was asked, in order, with the window it resolved to. */
	seen: Array<{ command: string; label?: string; view?: number; text?: string }>;
}

function twoWindows(): Recorded {
	const seen: Recorded["seen"] = [];
	const web = webviewResolver({
		windowLabels: () => Object.keys(VIEWS),
		webview: (label) => VIEWS[label],
	});
	/** A hit in window 11, a miss in window 22: the answer names the window that ran it. */
	const answer = (view: number): FindOutcome => ({
		matches: view === 11 ? 1 : 0,
		found: view === 11,
	});
	const adapter: FindAdapter = {
		search: async (query: FindQuery & { forward: boolean; matchCase: boolean }, label) => {
			const view = web(label);
			if (view === null) throw new Error("crust: findinpage needs a WKWebView");
			seen.push({ command: "search", label, view, text: query.text });
			return answer(view);
		},
		next: async (label) => {
			const view = web(label);
			if (view === null) throw new Error("crust: findinpage needs a WKWebView");
			seen.push({ command: "next", label, view });
			return answer(view);
		},
		previous: async (label) => {
			const view = web(label);
			if (view === null) throw new Error("crust: findinpage needs a WKWebView");
			seen.push({ command: "previous", label, view });
			return answer(view);
		},
		clear: (label) => {
			seen.push({ command: "clear", label, view: web(label) ?? undefined });
		},
	};
	return { adapter, seen };
}

describe("findinpage label", () => {
	test("a page naming each window searches that window's webview", async () => {
		const { adapter, seen } = twoWindows();
		const plugin = createFindInPagePlugin(adapter);
		expect(await plugin.commands.search({ text: "crust", label: "main" })).toEqual({
			ok: true,
			matches: 1,
			found: true,
		});
		expect(await plugin.commands.search({ text: "crust", label: "inspector" })).toEqual({
			ok: true,
			matches: 0,
			found: false,
		});
		expect(seen).toEqual([
			{ command: "search", label: "main", view: 11, text: "crust" },
			{ command: "search", label: "inspector", view: 22, text: "crust" },
		]);
	});

	test("next, previous and clear forward the label too", async () => {
		const { adapter, seen } = twoWindows();
		const plugin = createFindInPagePlugin(adapter);
		await plugin.commands.next({ label: "inspector" });
		await plugin.commands.previous({ label: "main" });
		plugin.commands.clear({ label: "inspector" });
		expect(seen).toEqual([
			{ command: "next", label: "inspector", view: 22 },
			{ command: "previous", label: "main", view: 11 },
			{ command: "clear", label: "inspector", view: 22 },
		]);
	});

	test("an omitted label still means the first open window", async () => {
		const { adapter, seen } = twoWindows();
		const plugin = createFindInPagePlugin(adapter);
		expect(await plugin.commands.search({ text: "crust" })).toEqual({
			ok: true,
			matches: 1,
			found: true,
		});
		await plugin.commands.next(undefined);
		expect(seen.map((call) => call.label)).toEqual([undefined, undefined]);
	});

	test("a label naming no open window is bad-request naming it, never the first window", async () => {
		const { adapter, seen } = twoWindows();
		const plugin = createFindInPagePlugin(adapter);
		const failure = plugin.commands.search({ text: "crust", label: "inspector-two" });
		await expect(failure).rejects.toThrow(CrustError);
		await expect(failure).rejects.toThrow(
			'crust: there is no open window "inspector-two"; open windows: ["main","inspector"]',
		);
		expect(seen).toEqual([]);
	});

	test("the refusal keeps the bridge's own code, not handler-error", async () => {
		const { adapter } = twoWindows();
		const plugin = createFindInPagePlugin(adapter);
		try {
			await plugin.commands.next({ label: "nope" });
			throw new Error("expected a refusal");
		} catch (error) {
			expect(error).toBeInstanceOf(CrustError);
			expect((error as CrustError).code).toBe("bad-request");
		}
	});

	test("a label that is not a non-empty string is refused before the adapter", async () => {
		const { adapter, seen } = twoWindows();
		const plugin = createFindInPagePlugin(adapter);
		await expect(
			plugin.commands.search({ text: "crust", label: 7 } as unknown as FindQuery),
		).rejects.toThrow('findinpage: "label" must be a non-empty string when given, got 7');
		await expect(plugin.commands.search({ text: "crust", label: "" })).rejects.toThrow(
			'findinpage: "label" must be a non-empty string when given, got ""',
		);
		expect(seen).toEqual([]);
	});
});
