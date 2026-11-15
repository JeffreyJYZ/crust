import { NAV } from "./nav";

/** One page the palette can open, flattened from the navigation that also builds the rail. */
export interface PageEntry {
	label: string;
	href: string;
	group: string;
}

/** Every page in navigation order: the rail, the sitemap and the palette read the same list. */
export const PAGES: readonly PageEntry[] = NAV.flatMap((group) =>
	group.items.map((item) => ({ label: item.label, href: item.href, group: group.label })),
);

/** Case-insensitive substring match on the page label or its group, keeping navigation order. */
export function searchPages(query: string): readonly PageEntry[] {
	const needle = query.trim().toLowerCase();
	if (needle === "") return PAGES;
	return PAGES.filter(
		(page) =>
			page.label.toLowerCase().includes(needle) || page.group.toLowerCase().includes(needle),
	);
}
