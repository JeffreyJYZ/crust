/**
 * `crust:navigation` aimed at a named window. The proof uses the resolver the app really wires
 * (`webviewResolver`), over fake pointers, so what is measured is the whole path a page takes:
 * command → plugin → adapter's last argument → resolver → one webview out of two.
 * No window is opened and no delegate is installed; a test that did would be a defect on a
 * machine someone is using.
 */

import { describe, expect, test } from "bun:test";
import { isNotImplemented } from "@/plugins/define.ts";
import { collector } from "@/plugins/navigation-fake.ts";
import { createNavigationPlugin, type NavigationAdapter } from "@/plugins/navigation.ts";
import { webviewResolver } from "@/platform/darwin/webview-target.ts";

/** Two open windows, two webviews: the resolver the app uses, over fake pointers. */
const VIEWS: Record<string, number> = { main: 11, inspector: 22 };

interface Recorded {
	adapter: NavigationAdapter;
	/** Every command the plugin handed the adapter, with the window it resolved to. */
	seen: Array<{ command: string; label?: string; view?: number }>;
}

function twoWindows(): Recorded {
	const seen: Recorded["seen"] = [];
	const web = webviewResolver({
		windowLabels: () => Object.keys(VIEWS),
		webview: (label) => VIEWS[label],
	});
	/** What that webview's page is; a wrong window answers a visibly different url. */
	const url = (view: number): string => `https://crust.dev/window-${view}`;
	const note = (
		command: string,
		label: string | undefined,
		view: number | null,
	): number | null => {
		seen.push({ command, label, view: view ?? undefined });
		return view;
	};
	const adapter: NavigationAdapter = {
		start: (_listener, label) => {
			note("start", label, web(label));
			return { ok: true, status: 0, reason: "installed" };
		},
		stop: (label) => {
			note("stop", label, web(label));
		},
		state: (label) => {
			const view = note("state", label, web(label));
			if (view === null) return null;
			return {
				url: url(view),
				title: `window ${view}`,
				loading: false,
				canGoBack: false,
				canGoForward: false,
			};
		},
		reload: (label) => note("reload", label, web(label)) !== null,
		goBack: (label) => note("goBack", label, web(label)) !== null,
		goForward: (label) => note("goForward", label, web(label)) !== null,
	};
	return { adapter, seen };
}

describe("navigation label", () => {
	test("a page naming each window reaches that window's webview", () => {
		const { adapter } = twoWindows();
		const plugin = createNavigationPlugin(adapter);
		const main = plugin.commands.state({ label: "main" }, collector().ctx);
		const inspector = plugin.commands.state({ label: "inspector" }, collector().ctx);
		expect(main).toEqual({
			ok: true,
			url: "https://crust.dev/window-11",
			title: "window 11",
			loading: false,
			canGoBack: false,
			canGoForward: false,
		});
		expect(inspector).toEqual({
			ok: true,
			url: "https://crust.dev/window-22",
			title: "window 22",
			loading: false,
			canGoBack: false,
			canGoForward: false,
		});
	});

	test("every command forwards its label as the adapter's last argument", () => {
		const { adapter, seen } = twoWindows();
		const plugin = createNavigationPlugin(adapter);
		const ctx = collector().ctx;
		plugin.commands.start({ label: "inspector" }, ctx);
		plugin.commands.reload({ label: "inspector" }, ctx);
		plugin.commands.goBack({ label: "main" }, ctx);
		plugin.commands.goForward({ label: "inspector" }, ctx);
		plugin.commands.stop({ label: "main" }, ctx);
		expect(seen).toEqual([
			{ command: "start", label: "inspector", view: 22 },
			{ command: "reload", label: "inspector", view: 22 },
			{ command: "goBack", label: "main", view: 11 },
			{ command: "goForward", label: "inspector", view: 22 },
			{ command: "stop", label: "main", view: 11 },
		]);
	});

	test("an omitted label still means the first open window", () => {
		const { adapter, seen } = twoWindows();
		const plugin = createNavigationPlugin(adapter);
		const answer = plugin.commands.state(undefined, collector().ctx);
		expect(answer).toMatchObject({ ok: true, url: "https://crust.dev/window-11" });
		// `{}` is the same request as no argument: the page sent no label.
		expect(plugin.commands.state({}, collector().ctx)).toMatchObject({
			ok: true,
			url: "https://crust.dev/window-11",
		});
		expect(seen.map((call) => call.label)).toEqual([undefined, undefined]);
	});

	test("a label naming no open window is bad-request naming it, never the first window", () => {
		const { adapter, seen } = twoWindows();
		const plugin = createNavigationPlugin(adapter);
		const answer = plugin.commands.reload({ label: "inspector-two" }, collector().ctx);
		expect(answer).toEqual({
			ok: false,
			code: "bad-request",
			message:
				'crust: there is no open window "inspector-two"; open windows: ["main","inspector"]',
		});
		// The adapter was never reached: a refusal must not act on some other window first.
		expect(seen).toEqual([]);
	});

	test("a label that is not a non-empty string is refused before the adapter", () => {
		const { adapter, seen } = twoWindows();
		const plugin = createNavigationPlugin(adapter);
		for (const label of [7, "", null, true]) {
			const answer = plugin.commands.state({ label } as { label: string }, collector().ctx);
			expect(answer).toMatchObject({ ok: false, code: "bad-request" });
			if (!("ok" in answer) || answer.ok) throw new Error("expected a refusal");
			expect(answer.message).toContain("navigation label must be a non-empty string");
		}
		expect(seen).toEqual([]);
	});

	test("stop refuses an unknown label too, instead of reporting a stop that never happened", () => {
		const { adapter, seen } = twoWindows();
		const answer = createNavigationPlugin(adapter).commands.stop(
			{ label: "inspector-two" },
			collector().ctx,
		);
		expect(answer).toMatchObject({ ok: false, code: "bad-request" });
		expect(seen).toEqual([]);
	});

	test("no adapter keeps the not-implemented answer whatever label is asked for", () => {
		const answer = createNavigationPlugin().commands.state({ label: "main" }, collector().ctx);
		expect(isNotImplemented(answer)).toBe(true);
	});
});
