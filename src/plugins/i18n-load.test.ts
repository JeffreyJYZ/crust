/**
 * `i18n.load`: a directory of `*.json` files becomes the catalogue without a hand-written import.
 * The pure loader is proven against real temp directories; the command is proven to merge what it
 * loads into an empty catalogue and to answer from it, with a fake loader for the merge cases.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CrustError } from "@/bridge/errors";
import { adapter, call } from "@/plugins/i18n-fixture";
import { loadCatalogue } from "@/plugins/i18n-load";
import { createI18nPlugin } from "@/plugins/i18n";

const dirs: string[] = [];
function localeDir(files: Record<string, string>): string {
	const dir = mkdtempSync(join(tmpdir(), "crust-i18n-"));
	dirs.push(dir);
	for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, name), body);
	return dir;
}
afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("loadCatalogue", () => {
	test("each *.json basename is a locale and other files are ignored", () => {
		const dir = localeDir({
			"en.json": '{"greeting":"Hello","files_other":"{count} files"}',
			"fr.json": '{"greeting":"Bonjour"}',
			"notes.txt": "not a locale",
		});
		expect(loadCatalogue(dir)).toEqual({
			en: { greeting: "Hello", files_other: "{count} files" },
			fr: { greeting: "Bonjour" },
		});
	});

	test("invalid JSON is refused by path, not silently skipped", () => {
		const dir = localeDir({ "en.json": "{not json" });
		expect(() => loadCatalogue(dir)).toThrow(CrustError);
		expect(() => loadCatalogue(dir)).toThrow(/en\.json is not valid JSON/);
	});

	test("a document that is not an object is refused", () => {
		const dir = localeDir({ "en.json": '["not","a","table"]' });
		expect(() => loadCatalogue(dir)).toThrow(/must hold an object of messages/);
	});

	test("a missing directory is a bad-request naming it", () => {
		const missing = join(tmpdir(), "crust-i18n-absent");
		expect(() => loadCatalogue(missing)).toThrow(CrustError);
		expect(() => loadCatalogue(missing)).toThrow(/cannot read/);
	});

	test("an empty directory yields an empty catalogue", () => {
		expect(loadCatalogue(localeDir({}))).toEqual({});
	});
});

describe("i18n.load command", () => {
	test("loads a real directory and translate answers from it", () => {
		const dir = localeDir({ "en.json": '{"greeting":"Hello {name}"}' });
		const plugin = createI18nPlugin({ adapter });
		expect(call(plugin, "load", { directory: dir })).toMatchObject({
			ok: true,
			available: ["en"],
		});
		expect(call(plugin, "messages")).toMatchObject({ ok: true, locale: "en" });
		expect(call(plugin, "translate", { key: "greeting", vars: { name: "Ada" } })).toMatchObject(
			{
				locale: "en",
				text: "Hello Ada",
			},
		);
	});

	test("a second load merges without dropping locales already supplied", () => {
		const plugin = createI18nPlugin({
			messages: { en: { title: "Crust" } },
			loader: () => ({ fr: { greeting: "Bonjour" } }),
		});
		const result = call(plugin, "load", { directory: "locales" }) as {
			available: string[];
		};
		expect(result.available.sort()).toEqual(["en", "fr"]);
		expect(call(plugin, "translate", { key: "title" })).toMatchObject({ text: "Crust" });
		call(plugin, "setLocale", { locale: "fr" });
		expect(call(plugin, "translate", { key: "greeting" })).toMatchObject({ text: "Bonjour" });
	});

	test("the loader receives the directory the page passed", () => {
		let seen: string | undefined;
		const plugin = createI18nPlugin({
			loader: (directory) => {
				seen = directory;
				return {};
			},
		});
		call(plugin, "load", { directory: "i18n/locales" });
		expect(seen).toBe("i18n/locales");
	});

	test("a missing directory argument is bad-request", () => {
		const plugin = createI18nPlugin({ adapter });
		expect(() => call(plugin, "load", {})).toThrow(/non-empty string/);
	});

	test("a directory with no JSON files answers with an empty list", () => {
		const plugin = createI18nPlugin({ adapter, loader: () => ({}) });
		expect(call(plugin, "load", { directory: "locales" })).toMatchObject({
			ok: true,
			available: [],
		});
	});
});
