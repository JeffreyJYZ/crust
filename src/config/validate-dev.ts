import type { Validator } from "./validator.ts";

export const DEV_KEYS = ["url", "beforeDevCommand"] as const;

export function validateDev(v: Validator, value: unknown): void {
	if (value === undefined) return;
	const dev = v.object("dev", value);
	if (!dev) return;
	v.only(dev, "dev", DEV_KEYS);
	v.string(dev, "url", "dev", false);
	v.string(dev, "beforeDevCommand", "dev", false);
}
