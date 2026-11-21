#!/usr/bin/env bun
/**
 * Internal links in the docs site, checked against the pages that exist: a renamed page leaves a 404 nobody clicks until a reader does. `.mdx` files are routes (`app/<path>/page.mdx`), so the check is a file lookup — `/docs/x` resolves to `app/docs/x/page.mdx`. The same applies to the navigation, which every page renders and which lives in `site/lib/nav.ts`.
 */
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { NAV, type NavGroup } from "../site/lib/nav.ts";

const APP = join(import.meta.dir, "..", "site", "app");

/** Every route the app can serve, from the file tree alone. */
export async function routes(dir = APP, prefix = ""): Promise<Set<string>> {
	const found = new Set<string>();
	for (const entry of await readdir(dir, { withFileTypes: true })) {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) {
			// Route groups like `(home)` do not appear in the URL.
			const segment = entry.name.startsWith("(") ? "" : `${entry.name}/`;
			for (const route of await routes(path, `${prefix}${segment}`)) found.add(route);
			continue;
		}
		if (entry.name === "page.mdx") found.add(`/${prefix}`.replace(/\/$/, "") || "/");
	}
	return found;
}

/** `[label](/docs/x)` and `href="/docs/x"`, which are the two shapes used in the pages. */
const LINK = /(?:\]\(|href=")(\/[a-zA-Z0-9/_-]*)/g;

async function pages(dir = APP): Promise<string[]> {
	const found: string[] = [];
	for (const entry of await readdir(dir, { withFileTypes: true })) {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) found.push(...(await pages(path)));
		else if (entry.name === "page.mdx") found.push(path);
	}
	return found;
}

/** The sidebar and the command palette are both built from `NAV`, so check its hrefs too. */
export function brokenNavLinks(known: Set<string>, nav: readonly NavGroup[]): string[] {
	const broken: string[] = [];
	for (const group of nav) {
		for (const item of group.items) {
			if (item.href !== "/" && !known.has(item.href))
				broken.push(`site/lib/nav.ts → ${item.href} (${item.label})`);
		}
	}
	return broken;
}

async function main(): Promise<number> {
	const known = await routes();
	const broken: string[] = [];

	for (const file of await pages()) {
		const text = await readFile(file, "utf8");
		for (const match of text.matchAll(LINK)) {
			const href = match[1] ?? "";
			// Anchors and external links are out of scope; only in-app paths are checked.
			if (href === "/" || known.has(href)) continue;
			broken.push(`${file.replace(APP, "site/app")} → ${href}`);
		}
	}
	broken.push(...brokenNavLinks(known, NAV));

	if (broken.length === 0) {
		console.log(`check:links  PASS  ${known.size} routes, every internal link resolves`);
		return 0;
	}

	console.log(`check:links  FAIL  ${broken.length} dead link(s)`);
	for (const line of broken) console.log(`  ${line}`);
	return 1;
}

if (import.meta.main) process.exit(await main());
