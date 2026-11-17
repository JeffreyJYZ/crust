/**
 * The escaped form of a string handed to `pgrep -f`. `pgrep` compiles that argument as an extended
 * regular expression, so a path carrying `.`, `(`, `[` or `+` matches more processes than the one it
 * names — a `.` matches any character, and an unbalanced `(` makes `pgrep` fail outright, so cleanup can
 * kill an unrelated process and the survivor check can report a false positive. The native e2e hands it
 * repo paths, and this repo's own path already contains dots.
 */

/** Every extended-regex metacharacter escaped, so `pgrep -f` matches the text literally. */
export function pgrepLiteral(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
