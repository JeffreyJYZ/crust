/**
 * Byte-exact query surgery shared by the label and token composers.
 *
 * Keys are compared decoded, exactly as `URLSearchParams.get` reads them, so an encoded spelling
 * (`%74oken=`) cannot survive a removal and shadow the credential the bridge appended. Every other
 * pair is kept verbatim: an app-configured URL may carry a signature whose encoding must not move.
 */

/** Drop empty pairs and every pair whose decoded key equals `name`. */
export function withoutQueryPairs(search: string, name: string): string[] {
	return search.split("&").filter((pair) => {
		if (pair.length === 0) return false;
		const equals = pair.indexOf("=");
		const rawKey = equals === -1 ? pair : pair.slice(0, equals);
		let key = rawKey;
		try {
			key = decodeURIComponent(rawKey.replace(/\+/g, " "));
		} catch {
			// A malformed escape is not the parameter name; keep the pair verbatim.
		}
		return key !== name;
	});
}
