/**
 * A window's identity, in the one place that writes it into a URL and reads it back out.
 *
 * The document URL carries it: `windowUrl` appends `?window=<label>` when the configured URL names
 * no window, so the page itself knows which window it is from `location.search`. The bridge then
 * reads that parameter twice — from the document request, to inject it into the page client, and
 * from the invoke request, to hand it to the handler as `ctx.window` — and both use this parser, so
 * the two can never disagree about what a label is.
 *
 * A label is a routing hint, never authority: the page states which window it is, the bridge cannot
 * verify that, and it does not need to. The bearer token is the credential; a label only decides
 * which window a command is addressed to, so a page that claims another label can mislabel itself
 * and nothing else. Nothing here is a security boundary.
 */

/** The query parameter that names a window. */
export const WINDOW_PARAM = "window";

/** A request-supplied identity: a non-blank string, or `undefined`. Never a guess. */
export function asWindowLabel(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : undefined;
}

/** Read `?window=` out of a search string (`"?a=1"` or `"a=1"`), or `undefined` when absent or blank. */
export function windowLabelFromSearch(search: string): string | undefined {
	return asWindowLabel(new URLSearchParams(search.replace(/^\?/, "")).get(WINDOW_PARAM));
}

/**
 * Append `?window=<label>` unless the URL already names a window, in which case it is returned
 * byte-exact — an app that opened its window with its own `window=` parameter said what it wants.
 *
 * The existing query is kept verbatim rather than re-encoded, because a URL the app configured is
 * the app's to define. The reference stays a *path* reference, never a query-only one: a query on
 * `child/relative` resolves to the same path a browser would have loaded without it, so the label
 * rides along without moving the document.
 */
export function withWindowLabel(url: string, label: string): string {
	const hashAt = url.indexOf("#");
	const head = hashAt === -1 ? url : url.slice(0, hashAt);
	const hash = hashAt === -1 ? "" : url.slice(hashAt);
	const queryAt = head.indexOf("?");
	const path = queryAt === -1 ? head : head.slice(0, queryAt);
	const search = queryAt === -1 ? "" : head.slice(queryAt + 1);
	if (windowLabelFromSearch(search) !== undefined) return url;
	const added = `${WINDOW_PARAM}=${encodeURIComponent(label)}`;
	return `${path}?${search.length > 0 ? `${search}&${added}` : added}${hash}`;
}
