/**
 * Query-string surgery for URLs a window is opened with. Kept out of `window-identity.ts` so that
 * file stays about what a label *is*; these are the byte-exact edits that put one on or take one off.
 *
 * Other query pairs stay verbatim: an app-configured URL may carry a signature whose encoding must
 * not change. Keys are compared decoded, so `%77indow=` cannot smuggle a label past the removal.
 */

import { WINDOW_PARAM } from "./window-identity.ts";

interface UrlParts {
	path: string;
	search: string;
	hash: string;
}

function splitUrl(url: string): UrlParts {
	const hashAt = url.indexOf("#");
	const head = hashAt === -1 ? url : url.slice(0, hashAt);
	const hash = hashAt === -1 ? "" : url.slice(hashAt);
	const queryAt = head.indexOf("?");
	return {
		path: queryAt === -1 ? head : head.slice(0, queryAt),
		search: queryAt === -1 ? "" : head.slice(queryAt + 1),
		hash,
	};
}

function withoutWindowPairs(search: string): string[] {
	return search.split("&").filter((pair) => {
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
}

/**
 * Replace every page-supplied `window=` with `label`. For a relative document crust composes, the
 * label comes from the `window.create` command rather than from a query the page controls.
 */
export function withForcedWindowLabel(url: string, label: string): string {
	const { path, search, hash } = splitUrl(url);
	const kept = withoutWindowPairs(search);
	kept.push(`${WINDOW_PARAM}=${encodeURIComponent(label)}`);
	return `${path}?${kept.join("&")}${hash}`;
}

/**
 * Strip every `window=` pair and add none. An absolute URL is the app's to define in full, so crust
 * adds no identity to it; `window.create` still appends the bridge's seed token there, so a label
 * the page put in the query must go or it would mint a document bound to a label the page picked.
 */
export function withoutWindowLabel(url: string): string {
	const { path, search, hash } = splitUrl(url);
	const kept = withoutWindowPairs(search);
	return kept.length === 0 ? `${path}${hash}` : `${path}?${kept.join("&")}${hash}`;
}
