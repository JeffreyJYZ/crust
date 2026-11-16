/**
 * The matcher `crust:network` decides with: one metacharacter (`*`), never a regular expression, so a
 * page cannot hand the main thread a catastrophic backtrack. A literal pattern must equal the URL;
 * with a `*` the parts must appear in order, anchored when the pattern does not start or end with one.
 *
 * Both sides are folded to lower case on a platform whose own paths compare case-insensitively
 * (macOS, Windows): a URL's host is case-insensitive by RFC, and so is the filesystem under it, so a
 * byte-wise compare there lets a `block` rule be dodged by changing the case of the host or the path.
 * Linux keeps the byte-wise compare, because there `/Etc/Hosts` and `/etc/hosts` are two files.
 */

/** How one match compares its two strings. */
export interface MatchOptions {
	/** Fold both sides to lower case first. Defaults to the host platform's own comparison. */
	caseInsensitive?: boolean;
}

/** True on a platform whose paths compare case-insensitively, so a byte-wise URL compare is a bypass. */
export function foldsCase(platform: string = process.platform): boolean {
	return platform === "darwin" || platform === "win32";
}

export function patternMatches(pattern: string, url: string, options: MatchOptions = {}): boolean {
	const fold = options.caseInsensitive ?? foldsCase();
	const needle = fold ? pattern.toLowerCase() : pattern;
	const subject = fold ? url.toLowerCase() : url;
	const parts = needle.split("*");
	if (parts.length === 1) return subject === needle;
	let index = 0;
	for (let at = 0; at < parts.length; at++) {
		const part = parts[at] ?? "";
		if (part.length === 0) continue;
		if (at === 0) {
			if (!subject.startsWith(part)) return false;
			index = part.length;
			continue;
		}
		if (at === parts.length - 1) {
			return subject.endsWith(part) && subject.length - part.length >= index;
		}
		const found = subject.indexOf(part, index);
		if (found < 0) return false;
		index = found + part.length;
	}
	return true;
}
