/**
 * The one wire format both native file panels read, and the bound they both store.
 *
 * A `bun:ffi` `cstring` argument is NUL-terminated, so a filter list cannot cross as the nested
 * structure the plugin accepts: it travels as `Name|*.txt;*.md\nImages|*.png` and each C side splits
 * it into its own API's shape — `OPENFILENAMEW.lpstrFilter`'s NUL-separated pairs on Windows, one
 * `GtkFileFilter` per group on Linux. One builder here means the two cannot drift.
 *
 * A group with no usable extension contributes nothing rather than an empty pattern: an empty pattern
 * matches every file, and a filter that matches everything is the fake success this layer removes.
 */
import type { OpenPanelOptions } from "./dialog";

/** `SHIM_DIALOG_MAX` on both platforms: more paths than this is a malformed answer, not a pick. */
export const DIALOG_MAX_PATHS = 16;

export function filterSpec(filters: OpenPanelOptions["filters"]): string {
	if (!filters || filters.length === 0) return "";
	const groups: string[] = [];
	for (const filter of filters) {
		const patterns: string[] = [];
		for (const raw of filter.extensions) {
			const ext = raw
				.trim()
				.replace(/^\*?\.?/, "")
				.toLowerCase();
			if (ext.length > 0) patterns.push(`*.${ext}`);
		}
		if (patterns.length === 0) continue;
		const name = filter.name.trim().length > 0 ? filter.name.trim() : patterns.join(", ");
		groups.push(`${name}|${[...new Set(patterns)].join(";")}`);
	}
	return groups.join("\n");
}
