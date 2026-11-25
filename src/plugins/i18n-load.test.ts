/**
 * `i18n.load`: a directory of `*.json` files becomes the catalogue without a hand-written import.
 * The pure loader is proven against real temp directories; the command is proven to merge what it
 * loads into an empty catalogue and to answer from it, with sync and async fake loaders.
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
	test("each *.json basename is a locale and other files are ignored", async () => {
		const dir = localeDir({
			"en.json": '{"greeting":"Hello","files_other":"{count} files"}',
			"fr.json": '{"greeting":"Bonjour"}',
			"notes.txt": "not a locale",
		});
		expect(await loadCatalogue(dir)).toEqual({
			en: { greeting: "Hello", files_other: "{count} files" },
			fr: { greeting: "Bonjour" },
		});
	});

	test("invalid JSON is refused by path, not silently skipped", async () => {
		const dir = localeDir({ "en.json": "{not json" });
		await expect(loadCatalogue(dir)).rejects.toThrow(CrustError);
		await expect(loadCatalogue(dir)).rejects.toThrow(/en\.json is not valid JSON/);
	});

	test("a document that is not an object is refused", async () => {
		const dir = localeDir({ "en.json": '["not","a","table"]' });
		await expect(loadCatalogue(dir)).rejects.toThrow(/must hold an object of messages/);
	});

	test("a missing directory is a bad-request naming it", async () => {
		const missing = join(tmpdir(), "crust-i18n-absent");
		await expect(loadCatalogue(missing)).rejects.toThrow(CrustError);
		await expect(loadCatalogue(missing)).rejects.toThrow(/cannot read/);
	});

	test("an empty directory yields an empty catalogue", async () => {
		expect(await loadCatalogue(localeDir({}))).toEqual({});
	});
});

describe("i18n.load command", () => {
	test("loads a real directory and translate answers from it", async () => {
		const dir = localeDir({ "en.json": '{"greeting":"Hello {name}"}' });
		const plugin = createI18nPlugin({ adapter });
		expect(await call(plugin, "load", { directory: dir })).toMatchObject({
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

	test("a sync fake loader still merges without dropping locales already supplied", async () => {
		const plugin = createI18nPlugin({
			messages: { en: { title: "Crust" } },
			loader: () => ({ fr: { greeting: "Bonjour" } }),
		});
		const result = (await call(plugin, "load", { directory: "locales" })) as {
			available: string[];
		};
		expect(result.available.sort()).toEqual(["en", "fr"]);
		expect(call(plugin, "translate", { key: "title" })).toMatchObject({ text: "Crust" });
		call(plugin, "setLocale", { locale: "fr" });
		expect(call(plugin, "translate", { key: "greeting" })).toMatchObject({ text: "Bonjour" });
	});

	test("a loaded locale adds its keys instead of replacing a table supplied in code", async () => {
		const plugin = createI18nPlugin({
			messages: { en: { title: "Crust", greeting: "Old hello" } },
			locale: "en",
			loader: () => ({ en: { greeting: "New hello" } }),
		});
		await call(plugin, "load", { directory: "locales" });
		expect(call(plugin, "messages")).toMatchObject({
			locale: "en",
			messages: { title: "Crust", greeting: "New hello" },
		});
		expect(call(plugin, "translate", { key: "title" })).toMatchObject({ text: "Crust" });
	});

	test("a __proto__ locale key is ignored instead of replacing the catalogue prototype", async () => {
		const loaded: Record<string, unknown> = { en: { greeting: "Hi" } };
		Object.defineProperty(loaded, "__proto__", {
			value: { pwned: "yes" },
			enumerable: true,
		});
		const plugin = createI18nPlugin({
			messages: { en: { title: "Crust" } },
			locale: "en",
			loader: () => loaded as never,
		});
		const result = (await call(plugin, "load", { directory: "locales" })) as {
			available: string[];
		};
		expect(result.available).toEqual(["en"]);
		expect(call(plugin, "translate", { key: "title" })).toMatchObject({ text: "Crust" });
	});

	test("an async loader is awaited before the command answers", async () => {
		const plugin = createI18nPlugin({
			loader: async (directory) => {
				await Bun.sleep(1);
				return { es: { greeting: `Hola ${directory}` } };
			},
		});
		const result = (await call(plugin, "load", { directory: "locales" })) as {
			available: string[];
		};
		expect(result.available).toEqual(["es"]);
		expect(call(plugin, "translate", { key: "greeting" })).toMatchObject({
			text: "Hola locales",
		});
	});

	test("the loader receives the directory the page passed", async () => {
		let seen: string | undefined;
		const plugin = createI18nPlugin({
			loader: (directory) => {
				seen = directory;
				return {};
			},
		});
		await call(plugin, "load", { directory: "i18n/locales" });
		expect(seen).toBe("i18n/locales");
	});

	test("a missing directory argument is bad-request", async () => {
		const plugin = createI18nPlugin({ adapter });
		await expect(call(plugin, "load", {})).rejects.toThrow(/non-empty string/);
	});

	test("a directory with no JSON files answers with an empty list", async () => {
		const plugin = createI18nPlugin({ adapter, loader: () => ({}) });
		expect(await call(plugin, "load", { directory: "locales" })).toMatchObject({
			ok: true,
			available: [],
		});
	});
});
