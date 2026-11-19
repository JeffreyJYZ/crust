/**
 * A window's identity, in the one place that writes it into a URL and reads it back out.
 *
 * The document URL carries it: `windowUrl` appends `?window=<label>` when the configured URL names
 * no window, so the page itself knows which window it is from `location.search`. The bridge then
 * reads that parameter twice — from the document request, to inject it into the page client, and
 * from the invoke request, to hand it to the handler as `ctx.window` — and both use this parser, so
 * the two can never disagree about what a label is.
 *
 * The same URL also carries `?token=<token>` for a bridge-served document, and *that* is a
 * credential: the document route refuses a request that does not present it, so a local process
 * that merely fetches `/` receives a `401` instead of the page's bearer token. A dev-server page is
 * served by Vite and never went through the bridge, so it carries no token and needs none.
 *
 * A label is a routing hint, never authority: the page states which window it is, the bridge cannot
 * verify that, and it does not need to. The bearer token is the credential; a label only decides
 * which window a command is addressed to, so a page that claims another label can mislabel itself
 * and nothing else. Nothing about a label is a security boundary. Authority is the label the bridge
 * bound to that token when it served the document, never the label the page sends in a request.
 */

import type { BridgeHandle } from "./server/types.ts";

/** The query parameter that names a window. */
export const WINDOW_PARAM = "window";

/**
 * The label a token is bound to when no document labeled it: the process token serves the
 * dev-server path, where Vite — not the bridge — served the page and no `?window=` was observed.
 */
export const DEFAULT_WINDOW_LABEL = "main";

/**
 * The query parameter that carries the bridge token on the *document* URL.
 *
 * The document is the only route that can hand out a credential, so it hands out nothing: the URL
 * carries the token, the route demands it, and the page reads it back out of `location.search`.
 * That keeps a process that merely fetches `/` from receiving a token it never had.
 */
export const TOKEN_PARAM = "token";

/**
 * The running bridge's token, for the one caller that builds a document URL without a bridge
 * handle in scope: `window.create` runs inside the `window` plugin, whose own construction site
 * belongs to the runtime rather than to this file set. Set once when the app starts; a process
 * has exactly one bridge, so this cannot go ambiguous.
 */
let bridgeToken: string | undefined;
let bridgeOrigin: string | undefined;

/** Record the token `window.create` must append. `undefined` clears it (tests, dev). */
export function setBridgeToken(token: string | undefined, origin?: string): void {
	bridgeToken = token;
	bridgeOrigin = token === undefined ? undefined : origin;
}

/** The recorded token, or `undefined` when no bridge has started. */
export function currentBridgeToken(): string | undefined {
	return bridgeToken;
}

/**
 * The same handle, with the token it recorded cleared when it stops.
 *
 * The recorded token is process-wide because `window.create` has no bridge in scope, so the writer
 * is the only place that can undo it — and a stopped bridge must not leave it behind: the next
 * window would carry a dead credential and the document route would answer `401`. Wrapping the
 * handle here means every caller of `startApp` gets the clear, including a test that only stops the
 * bridge in its teardown, so no test file can leave a token for the next one.
 */
export function tokenClearedOnStop(handle: BridgeHandle): BridgeHandle {
	const recorded = currentBridgeToken();
	return {
		...handle,
		async stop() {
			if (currentBridgeToken() === recorded) setBridgeToken(undefined);
			await handle.stop();
		},
	};
}

/**
 * Whether a URL points at this app's own bridge. A page-created window may name an absolute URL —
 * `/spare/child/absolute` reached through `location.origin` is the usual shape — and the document
 * route refuses a request with no token, so "absolute" cannot mean "carries no credential". The
 * comparison is on the origin the bridge recorded, so a genuinely foreign URL still passes through
 * untouched and the token never leaves the app's own origin.
 */
export function isBridgeOrigin(url: string): boolean {
	if (bridgeOrigin === undefined) return false;
	try {
		return new URL(url).origin === bridgeOrigin;
	} catch {
		return false;
	}
}

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

/**
 * Replace every page-supplied `window=` with `label`, leaving other query pairs byte-exact.
 *
 * `withWindowLabel` honours an existing label because a configured URL may name its own window.
 * A command a page invokes is different: `window.create` appends the bridge's seed token to the
 * URL it passes, so a `?window=admin` the page put there would mint a document bound to `admin`.
 * The label on a created window must come from the command, never from a query the page controls.
 * Keys are compared decoded, so `%77indow=` cannot smuggle a second label past the replacement.
 */
export function withForcedWindowLabel(url: string, label: string): string {
	const hashAt = url.indexOf("#");
	const head = hashAt === -1 ? url : url.slice(0, hashAt);
	const hash = hashAt === -1 ? "" : url.slice(hashAt);
	const queryAt = head.indexOf("?");
	const path = queryAt === -1 ? head : head.slice(0, queryAt);
	const search = queryAt === -1 ? "" : head.slice(queryAt + 1);
	const kept = search.split("&").filter((pair) => {
		if (pair.length === 0) return false;
		const equals = pair.indexOf("=");
		const rawKey = equals === -1 ? pair : pair.slice(0, equals);
		let key = rawKey;
		try {
			key = decodeURIComponent(rawKey.replace(/\+/g, " "));
		} catch {
			// A malformed escape is not our parameter name; keep the pair verbatim.
		}
		return key !== WINDOW_PARAM;
	});
	kept.push(`${WINDOW_PARAM}=${encodeURIComponent(label)}`);
	return `${path}?${kept.join("&")}${hash}`;
}

/** Read `?token=` out of a search string, or `undefined` when absent or blank. */
export function tokenFromSearch(search: string): string | undefined {
	const value = new URLSearchParams(search.replace(/^\?/, "")).get(TOKEN_PARAM);
	if (value === null) return undefined;
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Append `?token=<token>` to a bridge-served URL, keeping any query and hash it already carries.
 *
 * An existing `token` is replaced rather than duplicated: the token is the bridge's to define, so a
 * stale one on an app-configured URL would otherwise shadow the live credential and every page load
 * would answer `401`. A relative reference stays relative for the same reason `withWindowLabel`'s
 * does — a query on `child/x` does not move the document.
 */
export function withToken(url: string, token: string): string {
	const hashAt = url.indexOf("#");
	const head = hashAt === -1 ? url : url.slice(0, hashAt);
	const hash = hashAt === -1 ? "" : url.slice(hashAt);
	const queryAt = head.indexOf("?");
	const path = queryAt === -1 ? head : head.slice(0, queryAt);
	const search = queryAt === -1 ? "" : head.slice(queryAt + 1);
	const kept = search
		.split("&")
		.filter((pair) => pair.length > 0 && !pair.startsWith(`${TOKEN_PARAM}=`));
	kept.push(`${TOKEN_PARAM}=${encodeURIComponent(token)}`);
	return `${path}?${kept.join("&")}${hash}`;
}
