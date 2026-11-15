import { isAbsolute } from "node:path";

import type { Validator } from "./validator.ts";

export const FS_KEYS = ["scope"] as const;

/**
 * A scope entry is an absolute prefix, never a relative one: it would be resolved against whatever
 * cwd the process was launched with, so the same config would allow different directories on two
 * machines. The runtime refuses a relative grant for the same reason.
 */
export function validateFs(v: Validator, value: unknown): void {
	if (value === undefined) return;
	const fs = v.object("fs", value);
	if (!fs) return;
	v.only(fs, "fs", FS_KEYS);

	const scope = fs.scope;
	if (scope === undefined) return;
	if (!Array.isArray(scope)) {
		v.fail("fs.scope", "an array of absolute paths", scope);
		return;
	}
	scope.forEach((item, index) => {
		const path = `fs.scope[${index}]`;
		if (typeof item !== "string" || item.trim() === "") {
			v.fail(path, "a non-empty string", item);
			return;
		}
		if (!isAbsolute(item)) v.fail(path, "an absolute path", item);
	});
}
