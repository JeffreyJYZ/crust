/**
 * The shape of a `crust:i18n` catalogue and of every answer the plugin gives. Types only: the lookup
 * rules live in `i18n-messages.ts` and the command surface in `i18n.ts`, so a client can import a type
 * without pulling the plugin in.
 */

import type { NotImplemented, PluginDefinition } from "./define";

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

export interface I18nOptions {
	/** locale → key → text. Absent means `messages` and `translate` answer `not-implemented`. */
	messages?: MessageCatalogue;
	/** The locale to answer in before `setLocale`, and the one a lookup falls back to. */
	locale?: string;
	adapter?: I18nAdapter;
}

export interface LocaleResult {
	ok: true;
	/** The locale this answer is in, e.g. `"en-GB"`. */
	locale: string;
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
	}
>;
