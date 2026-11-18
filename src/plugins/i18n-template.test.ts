/**
 * The templates ship no i18n plugin, so the document's language and direction must be bound in the
 * page itself. These are file-level contracts: each scaffold's `<html>` declares both attributes and
 * its entry rebinds them from the configured locale, so an RTL locale is not stuck LTR/English.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const templates = join(import.meta.dir, "../../templates");
const owned = [
	{ name: "react", entry: "src/main.tsx" },
	{ name: "vue", entry: "src/main.ts" },
	{ name: "svelte", entry: "src/main.ts" },
];

describe("template document attributes", () => {
	test("each owned index.html declares lang and dir", () => {
		for (const { name } of owned) {
			const html = readFileSync(join(templates, name, "index.html"), "utf8");
			expect(html).toMatch(/<html[^>]*\blang=/);
			expect(html).toMatch(/<html[^>]*\bdir=/);
		}
	});

	test("each entry binds lang and dir from the configured locale", () => {
		for (const { name, entry } of owned) {
			const source = readFileSync(join(templates, name, entry), "utf8");
			expect(source).toContain("document.documentElement.lang = locale");
			expect(source).toContain("document.documentElement.dir =");
			expect(source).toContain("navigator.language");
		}
	});

	test("the bound RTL set covers the locales the report names", () => {
		for (const { name, entry } of owned) {
			const source = readFileSync(join(templates, name, entry), "utf8");
			for (const code of ["ar", "he", "fa"]) {
				expect(source).toContain(code);
			}
		}
	});
});

/** The two scaffolds F7 left out: a static export and the no-framework page. */
describe("leftover template document attributes", () => {
	const leftovers = [
		{
			name: "next",
			markup: "app/layout.tsx",
			entries: ["app/page.tsx", "app/about/page.tsx"],
		},
		{ name: "default", markup: "public/index.html", entries: ["public/app.js"] },
	];

	test('no leftover hardcodes lang="en" or dir="ltr"', () => {
		for (const { name, markup, entries } of leftovers) {
			for (const file of [markup, ...entries]) {
				const source = readFileSync(join(templates, name, file), "utf8");
				expect(source).not.toMatch(/lang\s*=\s*"en"/);
				expect(source).not.toMatch(/dir\s*=\s*"ltr"/);
			}
		}
	});

	test("each leftover binds lang and dir from the browser locale", () => {
		for (const { name, entries } of leftovers) {
			for (const entry of entries) {
				const source = readFileSync(join(templates, name, entry), "utf8");
				expect(source).toContain("document.documentElement.lang = locale");
				expect(source).toContain("document.documentElement.dir =");
				expect(source).toContain("navigator.language");
				for (const code of ["ar", "he", "fa"]) {
					expect(source).toContain(code);
				}
			}
		}
	});
});
