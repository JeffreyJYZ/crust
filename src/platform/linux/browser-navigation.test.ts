/**
 * The landed `onNavigate` contract on Linux, without GTK. The adapter's `navigate` path and the
 * kind-1 `decide-policy` signal both go through the same decision; a false answer must cancel and
 * leave the surface on its previous URL.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { BrowserOpenInput } from "@/plugins/browser";
import { SHIM_PARTS } from "./shim-source.ts";
import { linuxBrowserAdapter } from "./browser.ts";
import { FakePorts } from "./browser-fake.ts";
import {
	decideNavigation,
	firstLoadAware,
	type NavigationParts,
	NavigationDecisions,
	navigationAllowed,
} from "./browser-navigation.ts";

const TRUSTED = "https://trusted.example/";
const FOREIGN = "http://169.254.169.254/latest/meta-data/";
const BOUNDS = { x: 0, y: 0, width: 320, height: 200 };
const WEB = 0x400n;

interface Surface {
	label: string;
	onPopup(url: string): void;
}

function harness() {
	const fake = new FakePorts();
	const adapter = linuxBrowserAdapter(fake);
	const seen: string[] = [];
	const popups: string[] = [];
	const decide = (url: string): boolean => {
		seen.push(url);
		return !url.includes("169.254");
	};
	const open = adapter.open({
		label: "docs",
		url: TRUSTED,
		bounds: BOUNDS,
		onNavigate: decide,
		onPopup: (url: string) => popups.push(url),
	} as BrowserOpenInput & {
		onNavigate?: (url: string) => boolean;
		onPopup?: (url: string) => void;
	});
	return { fake, adapter, seen, popups, decide, open };
}

function partsFor(decide: (url: string) => boolean, onPopup: (url: string) => void): NavigationParts<Surface> {
	const decisions = new NavigationDecisions();
	decisions.set("docs", decide);
	const surface: Surface = { label: "docs", onPopup };
	return {
		find: (web) => (web === WEB ? surface : undefined),
		labelOf: (entry) => entry.label,
		urlOf: () => FOREIGN,
		decide: (label) => decisions.get(label),
		onPopup: (entry, url) => entry.onPopup(url),
		setSink: () => {},
	};
}

describe("the Linux committed-navigation gate", () => {
	test("open receives the decision and installs the decide-policy signal and sink", () => {
		const { open, fake } = harness();
		expect(open).toMatchObject({ ok: true });
		expect(fake.calls).toContain("watch_nav:400");
		expect(fake.calls).toContain("decision_sink:set");
	});

	test("navigate consults the decision and refuses a foreign target without committing", () => {
		const { adapter, fake, seen, decide } = harness();
		expect(decide(FOREIGN)).toBe(false);
		seen.length = 0;
		const before = fake.calls.length;
		expect(adapter.navigate("docs", FOREIGN)).toMatchObject({ ok: true, loaded: false });
		expect(seen).toEqual([FOREIGN]);
		expect(fake.calls.slice(before)).toEqual([]);
		expect(adapter.state("docs")).toMatchObject({ url: "http://127.0.0.1:4321/" });
	});

	test("an allowed target goes through to WebKit", () => {
		const { adapter, fake } = harness();
		expect(adapter.navigate("docs", `${TRUSTED}next`)).toMatchObject({ ok: true, loaded: true });
		expect(fake.calls.some((call) => call.startsWith("navigate:"))).toBe(true);
	});

	test("the decide-policy signal cancels a refused commit", () => {
		const { adapter, decide } = harness();
		const seen: string[] = [];
		const parts = partsFor(
			(url) => {
				seen.push(url);
				return decide(url);
			},
			() => {},
		);
		expect(decideNavigation(parts, 1, Number(WEB))).toBe(0);
		expect(seen).toEqual([FOREIGN]);
		expect(adapter.state("docs")).toMatchObject({ url: "http://127.0.0.1:4321/" });
	});

	test("a refused new window is not handed to the opener", () => {
		const { decide, popups } = harness();
		const parts = partsFor(decide, (url) => popups.push(url));
		expect(decideNavigation(parts, 0, Number(WEB))).toBe(0);
		expect(popups).toEqual([]);
	});

	test("a throwing decision refuses rather than slips past the gate", () => {
		expect(navigationAllowed(() => { throw new Error("page bug"); }, TRUSTED)).toBe(false);
	});

	test("kind 1 reads the decision URL, not the popup buffer", () => {
		const fake = new FakePorts();
		const seen: string[] = [];
		const parts = partsFor(
			(url) => {
				seen.push(url);
				return true;
			},
			() => {},
		);
		parts.urlOf = (kind) => (kind === 0 ? fake.popupUrl() : fake.decisionUrl());
		expect(decideNavigation(parts, 1, Number(WEB))).toBe(1);
		expect(seen).toEqual([fake.decisionUrl()]);
	});

	/**
	 * The first load already passed the plugin's entry check. Cancelling it left a real GTK surface
	 * with no document (ubuntu-latest 2026-11-21); a redirect or later navigation is still gated.
	 */
	test("the surface's first load is allowed, but its redirect and later commits are gated", () => {
		const seen: string[] = [];
		const gate = firstLoadAware(TRUSTED, (url) => {
			seen.push(url);
			return !url.includes("169.254");
		});
		expect(gate(TRUSTED)).toBe(true);
		expect(seen).toEqual([]);
		expect(gate("https://redirect.example/")).toBe(true);
		expect(seen).toEqual(["https://redirect.example/"]);
		expect(gate(FOREIGN)).toBe(false);
		expect(seen).toContain(FOREIGN);
	});
});

describe("the decide-policy hook in the shim", () => {
	test("a navigation decision is read from the action's URI request", () => {
		const browser = SHIM_PARTS[2];
		expect(browser).toContain('webkit_policy_decision_get_navigate_action');
		expect(browser).toContain('webkit_navigation_action_get_request');
		expect(browser).toContain('webkit_uri_request_get_uri');
		expect(browser).toContain('shim_view_connect(web, "decide-policy"');
		// Only navigation-action decisions are gated; a NEW_WINDOW_ACTION belongs to browser-popup.
		expect(browser).toContain("if (type != 0) return 0;");
		// An unreadable URI is not a reason to cancel the surface's first load.
		expect(browser).toContain("if (!shim_browser_navigation[0]) return 0;");
		// Popups and decisions own separate buffers: a later commit cannot erase a refused URL.
		expect(browser).toContain("int shim_browser_navigation_url(char *dst, int cap)");
		expect(browser).toContain("shim_browser_record(shim_browser_navigation, action)");
		// A refusal ignores the decision and handles the signal so WebKit's default use() cannot run.
		expect(browser).toContain("shim_policy_ignore(decision)");
		expect(browser).toContain("shim_browser_decision_sink(1, shim_browser_count, web)");
		const symbols = readFileSync(join(import.meta.dir, "shim-symbols.ts"), "utf8");
		expect(symbols).toContain("shim_browser_watch_nav: { args: [P], returns: I32 }");
		expect(symbols).toContain("shim_browser_set_decision_sink: { args: [P], returns: V }");
		expect(symbols).toContain("shim_browser_navigation_url: { args: [P, I32], returns: I32 }");
		const source = readFileSync(join(import.meta.dir, "browser.ts"), "utf8");
		expect(source).toContain("kind === 0 ? port().popupUrl() : port().decisionUrl()");
	});
});
