import { validateActivate } from "./validate-activate.ts";
import type { Validator } from "./validator.ts";

export const APP_KEYS = ["id", "name", "version", "icon", "activate"] as const;

export function validateApp(v: Validator, value: unknown): void {
	const app = v.object("app", value);
	if (!app) return;
	v.only(app, "app", APP_KEYS);
	const id = v.string(app, "id", "app", true);
	// Consumers build state paths by joining the id under Application Support and mkdir it at launch, so a
	// separator or dot token escapes the directory. single-instance refuses the same shape for its lock file.
	if (id !== undefined && (id === "." || id === ".." || id.includes("/") || id.includes("\\"))) {
		v.fail("app.id", "a single path-token without separators", id);
	}
	v.string(app, "name", "app", true);
	v.string(app, "version", "app", true);
	v.string(app, "icon", "app", false);
	validateActivate(v, app);
}
