/**
 * Turning a catalogue into text: which locale a lookup answers from, which plural form a count
 * selects, and how `{name}` is filled. No plugin, no adapter and no native half — the rules here are
 * pure, so the command surface stays a thin translation of arguments into calls.
 * Two refusals are deliberate: a key in no form, and a placeholder `vars` does not supply. Both reach a
 * user as a visible `{name}`, so they are raised as `bad-request` instead of being shipped.
 */

import { CrustError } from "../bridge/errors";
import type { MessageCatalogue, MessageTable, TranslateVars } from "./i18n-types";

/** The table a command answers from, and the locale it belongs to. */
export interface CatalogueLookup {
	locale: string;
	messages: MessageTable;
}

const PLACEHOLDER = /\{([A-Za-z_][A-Za-z0-9_]*)\}/g;

/** Every category `Intl.PluralRules` can select, so a catalogue can carry all six forms. */
export const PLURAL_CATEGORIES = ["zero", "one", "two", "few", "many", "other"] as const;
export type PluralCategory = (typeof PLURAL_CATEGORIES)[number];

/**
 * The plural category this locale and count select. Kept as all six categories: collapsing
 * `zero/two/few/many` into `other` makes a six-form locale such as Arabic answer the wrong string for
 * most counts. A locale tag `Intl` refuses is not one the caller meant, so the count alone decides.
 */
export function pluralCategory(locale: string, count: number): PluralCategory {
	try {
		return new Intl.PluralRules(locale).select(count) as PluralCategory;
	} catch {
		return count === 1 ? "one" : "other";
	}
}

/** The forms to try for a category: the exact one first, then the two safe fallbacks. */
export function pluralForms(category: PluralCategory): PluralCategory[] {
	return category === "other" ? ["other", "one"] : [category, "other", "one"];
}

/** Fill `{name}` from `vars`, refusing a placeholder nothing supplies. */
export function interpolate(
	template: string,
	vars: TranslateVars | undefined,
	key: string,
): string {
	return template.replace(PLACEHOLDER, (_match, name: string) => {
		const value = vars?.[name];
		if (value === undefined) {
			throw new CrustError(
				"bad-request",
				`i18n.translate: "${key}" needs {${name}}, which vars does not supply`,
			);
		}
		return String(value);
	});
}

/**
 * The table for the locale a caller wants, with the fallbacks a catalogue can honestly answer:
 * the exact identifier, then its language (`"en-GB"` → `"en"`), then the configured default, then the
 * first entry. The answer names the table it found, so a fallback is visible rather than a relabelled
 * copy of another locale's text.
 */
export function resolveCatalogue(
	catalogue: MessageCatalogue,
	preferred: string | undefined,
	fallback: string | undefined,
): CatalogueLookup | undefined {
	const first = Object.keys(catalogue)[0];
	const wanted = preferred ?? fallback ?? first;
	if (wanted === undefined) return undefined;
	for (const candidate of [wanted, wanted.split("-")[0], fallback, first]) {
		if (candidate === undefined) continue;
		const messages = catalogue[candidate];
		if (messages !== undefined) return { locale: candidate, messages };
	}
	return undefined;
}

/** The text for one key: the exact message, else the plural form `vars.count` selects. */
export function messageFor(
	messages: MessageTable,
	key: string,
	vars: TranslateVars | undefined,
	locale: string,
): string {
	const exact = messages[key];
	if (exact !== undefined) return interpolate(exact, vars, key);
	const count = vars?.count;
	let forms: PluralCategory[] = [];
	if (typeof count === "number" && Number.isFinite(count)) {
		forms = pluralForms(pluralCategory(locale, count));
		for (const form of forms) {
			const plural = messages[`${key}_${form}`];
			if (plural !== undefined) return interpolate(plural, vars, key);
		}
	}
	const pluralHint =
		forms.length > 0 ? ` (nor ${forms.map((form) => `${key}_${form}`).join(" or ")})` : "";
	throw new CrustError(
		"bad-request",
		`i18n.translate: "${key}" is not in the "${locale}" catalogue${pluralHint}`,
	);
}
