import type { Validator } from "./validator.ts";

export const SINGLE_INSTANCE_KEYS = ["id"] as const;

/**
 * `single-instance.id` names the lock file, so it must be one file-name token. The
 * same rule the lock applies at runtime is checked here to fail at config time with
 * the offending key, not at launch with a path-escaped lock.
 */
export function validateSingleInstance(v: Validator, value: unknown): void {
	if (value === undefined) return;
	const section = v.object("singleInstance", value);
	if (!section) return;
	v.only(section, "singleInstance", SINGLE_INSTANCE_KEYS);
	const id = v.string(section, "id", "singleInstance", false);
	if (id !== undefined && (id === "." || id === ".." || /[/\\]/.test(id))) {
		v.fail("singleInstance.id", "a single file-name token (no / or \\)", id);
	}
}
