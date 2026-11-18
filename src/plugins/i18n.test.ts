/**
 * `crust:i18n` locale and catalogue reads: the language the adapter reports, the choice `setLocale`
 * remembers, the fallback from a dialect to its language, and the two honest `not-implemented` answers.
 * Nothing here touches `NSLocale`; `platform/darwin/locale.ts` owns that read.
 */

import { describe, expect, test } from "bun:test";
import { CrustError } from "@/bridge/errors";
import { adapter, call, CATALOGUE } from "@/plugins/i18n-fixture";
import { createI18nPlugin } from "@/plugins/i18n";

describe("i18n.locale", () => {
	test("reports the language the adapter read", () => {
		const plugin = createI18nPlugin({ messages: CATALOGUE, adapter });
		expect(call(plugin, "locale")).toEqual({ ok: true, locale: "en-GB", dir: "ltr" });
	});

	test("a setLocale choice outranks the system's language", () => {
		const plugin = createI18nPlugin({ messages: CATALOGUE, adapter });
		expect(call(plugin, "setLocale", { locale: "fr" })).toEqual({
			ok: true,
			locale: "fr",
			dir: "ltr",
		});
		expect(call(plugin, "locale")).toEqual({ ok: true, locale: "fr", dir: "ltr" });
	});

	test("a plugin with neither an adapter nor a catalogue is not-implemented, naming NSLocale", () => {
		const result = call(createI18nPlugin(), "locale");
		expect(result).toMatchObject({ ok: false, code: "not-implemented", requires: "NSLocale" });
	});

	test("an empty locale is bad-request", () => {
		const plugin = createI18nPlugin({ messages: CATALOGUE, adapter });
		expect(() => call(plugin, "setLocale", { locale: "" })).toThrow(CrustError);
		expect(() => call(plugin, "setLocale", {})).toThrow(/non-empty string/);
	});
});

describe("i18n.messages", () => {
	test("a dialect falls back to its language, and the answer names the table it returned", () => {
		const plugin = createI18nPlugin({ messages: CATALOGUE, adapter });
		expect(call(plugin, "messages")).toEqual({
			ok: true,
			locale: "en",
			dir: "ltr",
			messages: CATALOGUE.en,
		});
	});

	test("an explicit locale picks that table", () => {
		const plugin = createI18nPlugin({ messages: CATALOGUE, adapter });
		expect(call(plugin, "messages", { locale: "fr" })).toEqual({
			ok: true,
			locale: "fr",
			dir: "ltr",
			messages: CATALOGUE.fr,
		});
	});

	test("no catalogue is not-implemented with the hint a caller needs", () => {
		expect(call(createI18nPlugin({ adapter }), "messages")).toEqual({
			ok: false,
			code: "not-implemented",
			message: "i18n: no message catalogue is loaded",
			requires: "createI18nPlugin({ messages })",
		});
	});
});
