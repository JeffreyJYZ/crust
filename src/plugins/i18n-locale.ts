/**
 * Locale → document attributes. A translation is only half the answer: a locale also decides which
 * way the document lays out and how a screen reader pronounces it. `Intl` has no direction API that
 * is everywhere, so the set of right-to-left base languages is named here, in one place, and every
 * caller (plugin results and template bindings) answers from the same rule.
 */

/** A base language subtag whose default script is right-to-left. */
const RTL_LANGUAGES = new Set([
	"ar", // Arabic
	"ckb", // Central Kurdish
	"dv", // Divehi
	"fa", // Persian
	"he", // Hebrew
	"ku", // Kurdish
	"ps", // Pashto
	"sd", // Sindhi
	"ug", // Uyghur
	"ur", // Urdu
	"yi", // Yiddish
]);

export type TextDirection = "ltr" | "rtl";

/** `rtl` when the locale's base language writes right-to-left, else `ltr`. */
export function textDirection(locale: string): TextDirection {
	const base = locale.split(/[-_]/)[0]?.toLowerCase();
	return base !== undefined && RTL_LANGUAGES.has(base) ? "rtl" : "ltr";
}

/** The two attributes a document needs to lay out and pronounce a locale correctly. */
export function localeAttributes(locale: string): { lang: string; dir: TextDirection } {
	return { lang: locale, dir: textDirection(locale) };
}
