import { isAbsolute } from "node:path";

import type { Validator } from "./validator.ts";

export const SHELL_KEYS = ["allow", "cwdRoot"] as const;

/**
 * A program entry is a bare name or an absolute path. A relative path would be
 * resolved against a `cwd` the page supplies, so the same entry would name
 * different programs; the runtime refuses those, and so does this.
 */
export function validateShell(v: Validator, value: unknown): void {
	if (value === undefined) return;
	const shell = v.object("shell", value);
	if (!shell) return;
	v.only(shell, "shell", SHELL_KEYS);
	v.string(shell, "cwdRoot", "shell", false);

	const allow = shell.allow;
	if (allow === undefined) return;
	if (!Array.isArray(allow)) {
		v.fail("shell.allow", "an array of program names", allow);
		return;
	}
	allow.forEach((item, index) => {
		const path = `shell.allow[${index}]`;
		if (typeof item !== "string" || item.trim() === "") {
			v.fail(path, "a non-empty string", item);
			return;
		}
		if ((item.includes("/") || item.includes("\\")) && !isAbsolute(item)) {
			v.fail(path, "a bare program name or an absolute path", item);
		}
	});
}
