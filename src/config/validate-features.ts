import type { Validator } from "./validator.ts";

export const PTY_KEYS = ["shell"] as const;
export const PREVIEW_KEYS = ["width", "height"] as const;
export const BROWSER_KEYS = ["origins"] as const;

/**
 * Each of these three sections is its feature's opt-in, so a message names the section and the key:
 * a typo in the section that declares a page-reachable pty would else register nothing and read as
 * "the feature is missing" rather than as a config error.
 */
export function validatePty(v: Validator, value: unknown): void {
	if (value === undefined) return;
	const pty = v.object("pty", value);
	if (!pty) return;
	v.only(pty, "pty", PTY_KEYS);
	v.string(pty, "shell", "pty", false);
}

/** Absent is valid: the panel opens at its default size, so only the two dimensions are checked. */
export function validatePreview(v: Validator, value: unknown): void {
	if (value === undefined) return;
	const preview = v.object("preview", value);
	if (!preview) return;
	v.only(preview, "preview", PREVIEW_KEYS);
	v.positiveInteger(preview, "width", "preview");
	v.positiveInteger(preview, "height", "preview");
}

/**
 * An origin carries no path: the check a load goes through compares origins, so a path here would
 * authorise nothing while reading as though it did. Absent is valid and allows nothing at all.
 */
export function validateBrowser(v: Validator, value: unknown): void {
	if (value === undefined) return;
	const browser = v.object("browser", value);
	if (!browser) return;
	v.only(browser, "browser", BROWSER_KEYS);

	const origins = browser.origins;
	if (origins === undefined) return;
	if (!Array.isArray(origins)) {
		v.fail("browser.origins", "an array of http(s) origins", origins);
		return;
	}
	origins.forEach((item, index) => {
		const path = `browser.origins[${index}]`;
		if (typeof item !== "string" || item.trim() === "") {
			v.fail(path, "an http(s) origin", item);
			return;
		}
		let url: URL;
		try {
			url = new URL(item);
		} catch {
			v.fail(path, "an http(s) origin", item);
			return;
		}
		if (url.protocol !== "http:" && url.protocol !== "https:") {
			v.fail(path, "an http(s) origin", item);
			return;
		}
		if (url.username !== "" || url.password !== "") {
			// originOf keeps only scheme, host and port, so a credential here silently widens
			// the rule to every path on that origin while reading as a scoped endpoint.
			v.fail(path, "an origin with no credentials — scheme, host and port only", item);
		}
		if (url.pathname !== "/" || url.search !== "" || url.hash !== "") {
			v.fail(path, "an origin, with no path, query or fragment", item);
		}
	});
}
