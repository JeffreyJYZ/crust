/**
 * `crust:i18n` translation: `{name}` interpolation, both plural forms, which catalogue a lookup answers
 * from, and the three refusals — a key in no form, a placeholder nothing supplies, an empty key.
 * The plural rule is `Intl.PluralRules`, so the count alone decides when a locale tag is unusable.
 */

import { describe, expect, test } from "bun:test";
import { adapter, call, CATALOGUE } from "@/plugins/i18n-fixture";
import { createI18nPlugin } from "@/plugins/i18n";

const plugin = () => createI18nPlugin({ messages: CATALOGUE, adapter });

describe("i18n.translate", () => {
	test("fills {name} from vars", () => {
		expect(call(plugin(), "translate", { key: "greeting", vars: { name: "Ada" } })).toEqual({
			ok: true,
			locale: "en",
			dir: "ltr",
			key: "greeting",
			text: "Hello Ada",
		});
	});

	test("chooses _one for a count of 1 and _other for the rest", () => {
		const one = call(plugin(), "translate", { key: "apples", vars: { count: 1 } });
		const many = call(plugin(), "translate", { key: "apples", vars: { count: 3 } });
		expect(one).toMatchObject({ text: "1 apple" });
		expect(many).toMatchObject({ text: "3 apples" });
	});

	test("setLocale changes which catalogue translate answers from", () => {
		const instance = plugin();
		call(instance, "setLocale", { locale: "fr" });
		expect(
			call(instance, "translate", { key: "greeting", vars: { name: "Ada" } }),
		).toMatchObject({
			locale: "fr",
			text: "Bonjour Ada",
		});
	});

	test("a key in no form is bad-request, naming the key and the locale", () => {
		expect(() => call(plugin(), "translate", { key: "missing" })).toThrow(/"missing"/);
		expect(() => call(plugin(), "translate", { key: "missing" })).toThrow(/"en" catalogue/);
	});

	test("a count with no plural forms names the forms it looked for", () => {
		const lookup = () => call(plugin(), "translate", { key: "missing", vars: { count: 2 } });
		expect(lookup).toThrow(/missing_other/);
		expect(lookup).toThrow(/missing_one/);
	});

	test("a placeholder nothing supplies is refused instead of reaching a user", () => {
		expect(() => call(plugin(), "translate", { key: "greeting" })).toThrow(/\{name\}/);
	});

	test("an empty key is bad-request", () => {
		expect(() => call(plugin(), "translate", { key: "" })).toThrow(/non-empty string/);
	});

	test("no catalogue is not-implemented with the exact hint", () => {
		expect(call(createI18nPlugin({ adapter }), "translate", { key: "greeting" })).toEqual({
			ok: false,
			code: "not-implemented",
			message: "i18n: no message catalogue is loaded",
			requires: "createI18nPlugin({ messages })",
		});
	});
});
