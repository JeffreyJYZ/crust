/**
 * The link checker must cover the navigation every docs page renders. The sidebar
 * and palette both read `site/lib/nav.ts`, so a dead nav href is a 404 nobody clicks
 * until a reader does — and the page-only walk never saw it.
 */
import { describe, expect, test } from "bun:test";
import { NAV, type NavGroup } from "../site/lib/nav.ts";
import { brokenNavLinks, routes } from "./check-links.ts";

describe("check:links navigation", () => {
	test("a nav entry pointing at a missing route is reported", () => {
		const nav: NavGroup[] = [
			{
				label: "Group",
				items: [
					{ label: "ok", href: "/docs/ok" },
					{ label: "dead", href: "/docs/guides/clipboard-DEAD" },
				],
			},
		];
		const broken = brokenNavLinks(new Set(["/docs/ok"]), nav);
		expect(broken).toHaveLength(1);
		expect(broken[0]).toContain("/docs/guides/clipboard-DEAD");
	});

	test("the shipped nav resolves against the shipped routes", async () => {
		expect(brokenNavLinks(await routes(), NAV)).toEqual([]);
	});

	test("the checker applies the nav check in its main walk", async () => {
		const src = await Bun.file(new URL("./check-links.ts", import.meta.url)).text();
		expect(src).toContain("brokenNavLinks(known, NAV)");
	});
});
