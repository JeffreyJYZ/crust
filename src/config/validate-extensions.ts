import { isAbsolute, normalize } from "node:path";

import { isDict, type Validator } from "./validator.ts";

/**
 * An extension entry is a file the loader resolves against the project directory, so a relative
 * path is expected here — unlike `fs.scope`, which must be absolute. One that climbs out of the
 * project is refused: it would name a file the build cannot embed from a fresh clone.
 */
export function validateExtensions(v: Validator, value: unknown): void {
	if (value === undefined) return;

	if (!Array.isArray(value)) {
		// A section object is the shape every other key has, so name the keys the author added
		// instead of only saying "expected an array".
		if (isDict(value)) {
			for (const key of Object.keys(value)) {
				v.fail(
					`extensions.${key}`,
					"nothing — extensions is a flat array of files",
					value[key],
				);
			}
			return;
		}
		v.fail("extensions", "an array of extension files", value);
		return;
	}

	value.forEach((item, index) => {
		const path = `extensions[${index}]`;
		if (typeof item !== "string" || item.trim() === "") {
			v.fail(path, "a non-empty string", item);
			return;
		}
		if (!isAbsolute(item) && normalize(item).startsWith("..")) {
			v.fail(path, "a path inside the project", item);
		}
	});
}
