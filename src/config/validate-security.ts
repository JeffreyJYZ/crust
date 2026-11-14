import type { Validator } from "./validator.ts";

export const SECURITY_KEYS = ["csp"] as const;

export function validateSecurity(v: Validator, value: unknown): void {
	if (value === undefined) return;
	const security = v.object("security", value);
	if (!security) return;
	v.only(security, "security", SECURITY_KEYS);
	v.string(security, "csp", "security", false);
}
