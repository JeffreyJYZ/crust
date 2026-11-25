/**
 * The shape of a `crust:i18n` catalogue and of every answer the plugin gives. Types only: the lookup
 * rules live in `i18n-messages.ts` and the command surface in `i18n.ts`, so a client can import a type
 * without pulling the plugin in.
 */

import type { NotImplemented, PluginDefinition } from "./define";
import type { ScopeCheck } from "./fs-scope-in-force.ts";

/** One locale's messages: key → text, with `{name}` placeholders. */
export type MessageTable = Record<string, string>;

/** The catalogue: a BCP-47 identifier such as `"en-GB"` → its messages. */
export type MessageCatalogue = Record<string, MessageTable>;

/** Values `{name}` is filled from. `count` additionally selects the plural form. */
export type TranslateVars = Record<string, string | number>;

/** The native half: the language macOS resolved for this user. */
export interface I18nAdapter {
	preferredLocale(): string;
}

/** Reads a directory of `*.json` locale files into a catalogue. Injected so `load` is testable without disk. A sync loader still satisfies this; the default reads async so it never blocks the pump. */
export type CatalogueLoader = (directory: string) => MessageCatalogue | Promise<MessageCatalogue>;

export interface I18nOptions {
	/** locale → key → text. Absent means `messages` and `translate` answer `not-implemented`. */
	messages?: MessageCatalogue;
	/** The locale to answer in before `setLocale`, and the one a lookup falls back to. */
	locale?: string;
	adapter?: I18nAdapter;
	/** Loader behind the `load` command. Defaults to the on-disk `loadCatalogue`. */
	loader?: CatalogueLoader;
	/**
	 * Boundary for the default disk loader's page-callable `load` command. The runtime hands the app's
	 * `fs.scope` here; a host-supplied loader owns its own paths and is not checked.
	 */
	scope?: ScopeCheck;
}

export interface LocaleResult {
	ok: true;
	/** The locale this answer is in, e.g. `"en-GB"`. */
	locale: string;
	/** The document direction that locale needs: `rtl` for ar/he/fa/…, else `ltr`. */
	dir: "ltr" | "rtl";
}

export interface MessagesResult extends LocaleResult {
	/** The table that was found, which is the one the reported locale names. */
	messages: MessageTable;
}

export interface TranslationResult extends LocaleResult {
	key: string;
	/** The message with every `{name}` replaced and the plural form already chosen. */
	text: string;
}

export interface LoadResult extends LocaleResult {
	/** Every locale now available, including those supplied before `load`. */
	available: string[];
}

export type I18nPlugin = PluginDefinition<
	"i18n",
	{
		locale: () => LocaleResult | NotImplemented;
		setLocale: (args: { locale: string }) => LocaleResult;
		messages: (args?: { locale?: string }) => MessagesResult | NotImplemented;
		translate: (args: {
			key: string;
			vars?: TranslateVars;
		}) => TranslationResult | NotImplemented;
		load: (args: { directory: string }) => LoadResult | Promise<LoadResult>;
	}
>;
