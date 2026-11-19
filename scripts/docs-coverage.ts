/**
 * Namespace-level coverage of the docs site.
 *
 * A registered namespace is covered when a heading in a `reference/api*` page or in a guide names
 * it, or when a guide lives at `guides/<name>` (that route is the guide for it — `keychain`'s page
 * is titled "Secure storage", so only its route names the namespace). Headings are matched by exact
 * token, so `## \`window-state\`` never covers `window`.
 *
 * This compares names only. Nothing here reads a documented arg shape.
 */

export interface DocPage {
	path: string;
	text: string;
}

const HEADING = /^#{1,6}\s+/;

/** Whole tokens of a heading, with backticks removed: letters, digits and hyphens stay joined. */
function headingNames(heading: string, name: string): boolean {
	const cleaned = heading.replace(/`/g, "");
	return (cleaned.match(/[a-z0-9-]+/gi) ?? []).some((token) => token.toLowerCase() === name);
}

function headings(text: string): string[] {
	return text
		.split("\n")
		.filter((line) => HEADING.test(line))
		.map((line) => line.replace(HEADING, ""));
}

function covers(path: string, text: string, name: string): boolean {
	if (path.includes("/guides/") && path.includes(`/guides/${name}/`)) return true;
	if (!(path.includes("/reference/api") || path.includes("/guides/"))) return false;
	return headings(text).some((heading) => headingNames(heading, name));
}

/** The namespaces no page covers, sorted so the failure message reads the same on every run. */
export function uncoveredNamespaces(
	namespaces: readonly string[],
	pages: readonly DocPage[],
): string[] {
	return namespaces
		.filter((name) => !pages.some((page) => covers(page.path, page.text, name)))
		.sort();
}
