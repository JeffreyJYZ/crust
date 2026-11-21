/**
 * The origin gate after `open`. A page can redirect its own surface, so entry checks alone do not
 * hold the boundary: the surface carries a decision and the platform must consult it on every
 * commit. These tests drive that seam at the plugin boundary with a fake platform — the fake's
 * `commit` is what a WKNavigationDelegate / NavigationStarting / decide-policy handler does — so a
 * redirect chain that lands on a foreign origin is refused without touching a real webview.
 */
import { describe, expect, test } from "bun:test";
import { createBrowserPlugin } from "@/plugins/browser";
import { ALLOWED, BOUNDS, collector, FakeBrowser } from "@/plugins/browser-fake";

const TRUSTED = "https://trusted.example";
const FOREIGN = "http://169.254.169.254/latest/meta-data/";

function surface(): FakeBrowser {
	const fake = new FakeBrowser();
	const plugin = createBrowserPlugin({ origins: [TRUSTED] }, fake);
	const opened = plugin.commands.open(
		{ label: "docs", url: `${TRUSTED}/`, bounds: BOUNDS, owner: "main" },
		collector().ctx,
	);
	expect(opened).toEqual({ ok: true, label: "docs" });
	return fake;
}

describe("browser committed-navigation decision", () => {
	test("open installs a decision on the surface, not just an entry gate", () => {
		const fake = surface();
		expect(fake.decisions.get("docs")).toBeTypeOf("function");
	});

	test("a redirect chain to a foreign origin stops at the foreign hop", () => {
		const fake = surface();
		const decide = fake.decisions.get("docs")!;

		expect(decide(`${TRUSTED}/start`)).toBe(true);
		expect(decide(`${TRUSTED}/hop?next=%2Fmeta`)).toBe(true);
		// A same-origin hop is allowed; the metadata endpoint the page redirects to is not.
		expect(decide(FOREIGN)).toBe(false);
		expect(decide("file:///etc/passwd")).toBe(false);
		expect(decide(`https://trusted.example.evil.test/`)).toBe(false);
	});

	test("the fake platform leaves the reported URL where the chain stopped", () => {
		const fake = surface();
		expect(fake.commit("docs", `${TRUSTED}/start`)).toBe(`${TRUSTED}/start`);
		expect(fake.commit("docs", `${TRUSTED}/hop`)).toBe(`${TRUSTED}/hop`);
		expect(fake.commit("docs", FOREIGN)).toBeUndefined();
		expect(fake.commit("docs", "not a url")).toBeUndefined();
		expect(fake.state_["docs"]?.url).toBe(`${TRUSTED}/hop`);
		expect(fake.attempts).toEqual([
			{ label: "docs", url: `${TRUSTED}/start`, allowed: true },
			{ label: "docs", url: `${TRUSTED}/hop`, allowed: true },
			{ label: "docs", url: FOREIGN, allowed: false },
			{ label: "docs", url: "not a url", allowed: false },
		]);
	});

	test("a surface with no origins still refuses every committed navigation", () => {
		const fake = new FakeBrowser();
		const plugin = createBrowserPlugin(undefined, fake);
		plugin.commands.open(
			{ label: "none", url: `${ALLOWED}/`, bounds: BOUNDS },
			collector().ctx,
		);
		// With no allowlist `open` refuses too, so there is no decision installed; a platform that
		// somehow has a surface with no decision must fail closed rather than allow the commit.
		expect(fake.decisions.has("none")).toBe(false);
		expect(fake.commit("none", ALLOWED)).toBeUndefined();
	});
});
