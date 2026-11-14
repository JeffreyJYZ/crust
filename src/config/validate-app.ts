import type { Validator } from "./validator.ts";

export const APP_KEYS = ["id", "name", "version", "icon"] as const;

export function validateApp(v: Validator, value: unknown): void {
	const app = v.object("app", value);
	if (!app) return;
	v.only(app, "app", APP_KEYS);
	v.string(app, "id", "app", true);
	v.string(app, "name", "app", true);
	v.string(app, "version", "app", true);
	v.string(app, "icon", "app", false);
}
