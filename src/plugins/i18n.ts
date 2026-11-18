/**
 * `crust:i18n` — the language the app should speak, and the catalogue that answers in it. The only native half is the preferred language read; the catalogue is plain data a caller supplies, so the same plugin works where `NSLocale` is unreachable once messages are loaded.
 * This file is the command surface: it resolves which locale to answer in and hands the text rules to `i18n-messages.ts`. A catalogue is `locale → key → text`, and `translate` resolves `key`, then the plural form `vars.count` selects (`key_zero`/`key_one`/`key_two`/`key_few`/`key_many`/`key_other`), then interpolates `{name}` from `vars`. Every answer also names the document direction `dir`, so a page can set `lang` and `dir` without re-deriving them.
 * `setLocale` is in-memory on purpose: macOS keeps the language list in System Settings, so an app cannot change it, and pretending otherwise would report a language the system does not use.
 * `load` reads a directory of `*.json` files into the catalogue at runtime, so an app need not hand-write an import per locale; the on-disk reader lives in `i18n-load.ts` and is injectable for tests.
 */

import { CrustError } from "../bridge/errors";
import { definePlugin, notImplemented, type NotImplemented } from "./define";
import { loadCatalogue } from "./i18n-load";
import { textDirection } from "./i18n-locale";
import { messageFor, resolveCatalogue } from "./i18n-messages";
import type {
	CatalogueLoader,
	I18nOptions,
	I18nPlugin,
	LoadResult,
	LocaleResult,
	MessagesResult,
	TranslationResult,
	TranslateVars,
} from "./i18n-types";

export { localeAttributes, textDirection } from "./i18n-locale";
export type { TextDirection } from "./i18n-locale";

export type {
	CatalogueLoader,
	I18nAdapter,
	I18nOptions,
	I18nPlugin,
	LoadResult,
	LocaleResult,
	MessageCatalogue,
	MessagesResult,
	MessageTable,
	TranslationResult,
	TranslateVars,
} from "./i18n-types";

const NO_CATALOGUE = "i18n: no message catalogue is loaded";
const CATALOGUE_HINT = "createI18nPlugin({ messages })";

export function createI18nPlugin(options: I18nOptions = {}): I18nPlugin {
	const native = options.adapter;
	const loader: CatalogueLoader = options.loader ?? loadCatalogue;
	let catalogue = options.messages ?? {};
	/** The language a page asked for through `setLocale`. */
	let override: string | undefined;

	const noCatalogue = (): NotImplemented => notImplemented(NO_CATALOGUE, CATALOGUE_HINT);

	/** The locale to answer in: the page's request, its earlier choice, the default, then the system's. */
	const preferred = (requested?: string): string | undefined =>
		requested ?? override ?? options.locale ?? native?.preferredLocale();

	return definePlugin({
		name: "i18n",
		commands: {
			/**
			 * The language the app speaks. Same resolution as `translate` — page choice, configured
			 * locale, then system — so the indicator cannot name one language while the text is in another.
			 */
			locale: (): LocaleResult | NotImplemented => {
				const chosen = preferred() ?? Object.keys(catalogue)[0];
				if (chosen !== undefined)
					return { ok: true, locale: chosen, dir: textDirection(chosen) };
				return notImplemented(
					"i18n.locale needs NSLocale preferredLanguages, which only Foundation provides. Pass an I18nAdapter to createI18nPlugin on a platform that has none.",
					"NSLocale",
				);
			},
			/** Record the language a page wants. Nothing is written to the system, which owns that list. */
			setLocale: (args: { locale: string }): LocaleResult => {
				const locale = args?.locale;
				if (typeof locale !== "string" || locale.length === 0) {
					throw new CrustError(
						"bad-request",
						'i18n.setLocale: "locale" must be a non-empty string',
					);
				}
				override = locale;
				return { ok: true, locale, dir: textDirection(locale) };
			},
			/** The whole table for a locale, so a page can format or audit what it will show. */
			messages: (args?: { locale?: string }): MessagesResult | NotImplemented => {
				const found = resolveCatalogue(catalogue, preferred(args?.locale), options.locale);
				if (found === undefined) return noCatalogue();
				return {
					ok: true,
					locale: found.locale,
					dir: textDirection(found.locale),
					messages: found.messages,
				};
			},
			/** One message, with the plural form and every `{name}` resolved. */
			translate: (args: {
				key: string;
				vars?: TranslateVars;
			}): TranslationResult | NotImplemented => {
				const key = args?.key;
				if (typeof key !== "string" || key.length === 0) {
					throw new CrustError(
						"bad-request",
						'i18n.translate: "key" must be a non-empty string',
					);
				}
				const found = resolveCatalogue(catalogue, preferred(), options.locale);
				if (found === undefined) return noCatalogue();
				const vars = args?.vars;
				return {
					ok: true,
					locale: found.locale,
					dir: textDirection(found.locale),
					key,
					text: messageFor(found.messages, key, vars, found.locale),
				};
			},
			/** Read `locales/*.json` from a directory into the catalogue, so no import is hand-written. */
			load: async (args: { directory: string }): Promise<LoadResult> => {
				Object.assign(catalogue, await loader(args?.directory));
				const available = Object.keys(catalogue);
				const chosen = preferred() ?? available[0] ?? options.locale ?? "en";
				return { ok: true, locale: chosen, dir: textDirection(chosen), available };
			},
		},
	});
}

/** The default registration: no catalogue and no adapter, so every command answers honestly. */
export const i18nPlugin = createI18nPlugin();
