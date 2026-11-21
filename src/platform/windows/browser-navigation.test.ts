/**
 * The landed `onNavigate` contract on Windows, without WebView2. Two paths are exercised: the
 * adapter's `navigate` call and the kind-1 NavigationStarting event C delivers through the sink.
 * Both must consult the decision and leave the surface on its previous URL when it answers false.
 */
import { describe, expect, test } from "bun:test";
import type { BrowserOpenInput } from "@/plugins/browser";
import { windowsBrowserAdapter } from "./browser.ts";
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

interface Surface {
	label: string;
	onPopup(url: string): void;
}

function harness() {
	const fake = new FakePorts();
	const adapter = windowsBrowserAdapter(fake);
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

describe("the Windows committed-navigation gate", () => {
	test("open receives and stores the decision, and the native sink is registered", () => {
		const { open, fake } = harness();
		expect(open).toMatchObject({ ok: true });
		expect(fake.calls).toContain("sink:set");
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

	test("an allowed target goes through to WebView2", () => {
		const { adapter, fake } = harness();
		expect(adapter.navigate("docs", `${TRUSTED}next`)).toMatchObject({ ok: true, loaded: true });
		expect(fake.calls.some((call) => call.startsWith("navigate:"))).toBe(true);
	});

	test("the NavigationStarting event cancels a refused commit and keeps the page", () => {
		const { adapter, decide, seen } = harness();
		const decisions = new NavigationDecisions();
		decisions.set("docs", decide);
		seen.length = 0;
		const surface: Surface = { label: "docs", onPopup: () => {} };
		const parts: NavigationParts<Surface> = {
			find: (web) => (web === 0x900 + 1 ? surface : undefined),
			labelOf: (entry) => entry.label,
			urlOf: () => FOREIGN,
			decide: (label) => decisions.get(label),
			onPopup: (entry, url) => entry.onPopup(url),
			setSink: () => {},
		};
		expect(decideNavigation(parts, 1, 0x900 + 1)).toBe(0);
		expect(seen).toEqual([FOREIGN]);
		expect(adapter.state("docs")).toMatchObject({ url: "http://127.0.0.1:4321/" });
	});

	test("a refused new window is not handed to the opener", () => {
		const { decide, popups } = harness();
		const decisions = new NavigationDecisions();
		decisions.set("docs", decide);
		const surface: Surface = { label: "docs", onPopup: (url) => popups.push(url) };
		const parts: NavigationParts<Surface> = {
			find: (web) => (web === 0x900 + 1 ? surface : undefined),
			labelOf: (entry) => entry.label,
			urlOf: () => FOREIGN,
			decide: (label) => decisions.get(label),
			onPopup: (entry, url) => entry.onPopup(url),
			setSink: () => {},
		};
		expect(decideNavigation(parts, 0, 0x900 + 1)).toBe(0);
		expect(popups).toEqual([]);
	});

	test("a throwing decision refuses rather than slips past the gate", () => {
		expect(navigationAllowed(() => { throw new Error("page bug"); }, TRUSTED)).toBe(false);
	});

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
