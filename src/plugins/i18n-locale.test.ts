/**
 * The three i18n fixes: a six-category plural table (Arabic counts must not collapse to `_other`),
 * one resolution for `locale` and `translate`, and the `lang`/`dir` attributes a page needs so a
 * locale changes layout and pronunciation as well as text.
 */

import { describe, expect, test } from "bun:test";
import { adapter, call, CATALOGUE } from "@/plugins/i18n-fixture";
import { createI18nPlugin } from "@/plugins/i18n";
import { localeAttributes, textDirection } from "@/plugins/i18n-locale";
import { pluralCategory, pluralForms, type PluralCategory } from "@/plugins/i18n-messages";

const ARABIC = {
	ar: {
		items_zero: "لا عناصر",
		items_one: "عنصر واحد",
		items_two: "عنصران",
		items_few: "{count} عناصر",
		items_many: "{count} عنصرًا",
		items_other: "{count} عنصر",
	},
};

describe("textDirection", () => {
	test("right-to-left base languages and their dialects", () => {
		for (const locale of ["ar", "ar-EG", "he", "fa-IR", "ur", "yi"]) {
			expect(textDirection(locale)).toBe("rtl");
		}
	});

	test("left-to-right languages stay ltr", () => {
		for (const locale of ["en", "en-GB", "de", "fr", "ja"]) {
			expect(textDirection(locale)).toBe("ltr");
		}
	});

	test("localeAttributes answers lang and dir from one locale", () => {
		expect(localeAttributes("ar-EG")).toEqual({ lang: "ar-EG", dir: "rtl" });
		expect(localeAttributes("en")).toEqual({ lang: "en", dir: "ltr" });
	});
});

describe("plural categories", () => {
	test("Arabic counts select all six Intl categories, not one/other", () => {
		const table: Array<[number, PluralCategory]> = [
			[0, "zero"],
			[1, "one"],
			[2, "two"],
			[3, "few"],
			[11, "many"],
			[100, "other"],
		];
		for (const [count, category] of table) {
			expect(pluralCategory("ar", count)).toBe(category);
		}
	});

	test("forms try the exact category first, then other and one", () => {
		expect(pluralForms("two")).toEqual(["two", "other", "one"]);
		expect(pluralForms("other")).toEqual(["other", "one"]);
	});

	test("translate answers the right Arabic form for each count", () => {
		const plugin = createI18nPlugin({ locale: "ar", messages: ARABIC });
		const expected: Array<[number, string]> = [
			[0, "لا عناصر"],
			[1, "عنصر واحد"],
			[2, "عنصران"],
			[3, "3 عناصر"],
			[11, "11 عنصرًا"],
			[100, "100 عنصر"],
		];
		for (const [count, text] of expected) {
			expect(call(plugin, "translate", { key: "items", vars: { count } })).toMatchObject({
				locale: "ar",
				dir: "rtl",
				text,
			});
		}
	});

	test("a missing category falls back to _other rather than failing", () => {
		const only = { ar: { items_one: "one", items_other: "many" } };
		const plugin = createI18nPlugin({ locale: "ar", messages: only });
		expect(call(plugin, "translate", { key: "items", vars: { count: 0 } })).toMatchObject({
			text: "many",
		});
	});
});

describe("one locale answer", () => {
	test("locale and translate agree when configured and system language differ", () => {
		const systemEnglish = { preferredLocale: () => "en" };
		const plugin = createI18nPlugin({
			locale: "de",
			messages: { de: { greeting: "Hallo" }, en: { greeting: "Hello" } },
			adapter: systemEnglish,
		});
		expect(call(plugin, "locale")).toMatchObject({ locale: "de", dir: "ltr" });
		expect(call(plugin, "translate", { key: "greeting" })).toMatchObject({
			locale: "de",
			text: "Hallo",
		});
		expect(call(plugin, "messages")).toMatchObject({ locale: "de" });
	});

	test("setLocale updates locale, direction and translate together", () => {
		const plugin = createI18nPlugin({
			messages: { ar: { greeting: "مرحبا" }, ...CATALOGUE },
			adapter,
		});
		expect(call(plugin, "setLocale", { locale: "ar" })).toMatchObject({
			locale: "ar",
			dir: "rtl",
		});
		expect(call(plugin, "locale")).toMatchObject({ locale: "ar", dir: "rtl" });
		expect(call(plugin, "translate", { key: "greeting" })).toMatchObject({
			locale: "ar",
			dir: "rtl",
			text: "مرحبا",
		});
	});

	test("an underscore locale narrows to its base language like a hyphen one", () => {
		const plugin = createI18nPlugin({
			messages: { en: { greeting: "Hello" }, ar: { greeting: "مرحبا" } },
			adapter,
		});
		expect(call(plugin, "setLocale", { locale: "ar_SA" })).toMatchObject({ dir: "rtl" });
		expect(call(plugin, "translate", { key: "greeting" })).toMatchObject({
			locale: "ar",
			dir: "rtl",
			text: "مرحبا",
		});
		expect(call(plugin, "messages")).toMatchObject({ locale: "ar", dir: "rtl" });
	});
});
