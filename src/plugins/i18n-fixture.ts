/**
 * The fixture both `crust:i18n` suites share: a two-locale catalogue, an adapter that answers a
 * dialect so the fallback to its language is exercised, and the invoke helper that calls a command the
 * way the bridge does. A second copy of these in another test file would be a second contract.
 */

import type { I18nAdapter, I18nPlugin, MessageCatalogue } from "./i18n-types";

export const CATALOGUE: MessageCatalogue = {
	en: {
		greeting: "Hello {name}",
		apples_one: "{count} apple",
		apples_other: "{count} apples",
		title: "Crust",
	},
	fr: {
		greeting: "Bonjour {name}",
	},
};

/** The system says `en-GB`, so a lookup has to narrow to `en` to find anything. */
export const adapter: I18nAdapter = { preferredLocale: () => "en-GB" };

/** Run one command as the bridge does: the handler with its own arguments, nothing else. */
export function call(plugin: I18nPlugin, name: string, args?: unknown): unknown {
	const table = plugin.commands as Record<string, (input?: unknown) => unknown>;
	const handler = table[name];
	if (handler === undefined) throw new Error(`no command ${name}`);
	return handler(args);
}
