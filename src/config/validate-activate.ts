import type { Dict, Validator } from "./validator.ts";

export const ACTIVATE_MODES = ["always", "first", "never"] as const;

/**
 * `app.activate` is an enum, not free text: `always` raises the app on every window create (the
 * default, and what keeps a window in `AXWindows`), `first` only for the first window of the launch,
 * `never` not at all. A misspelling would otherwise read as "some string" and land as one of the
 * three behaviours by accident, so it is refused here naming the accepted set.
 */
export function validateActivate(v: Validator, app: Dict): void {
	const value = app.activate;
	if (value === undefined) return;
	if (typeof value !== "string" || !(ACTIVATE_MODES as readonly string[]).includes(value)) {
		v.fail(
			"app.activate",
			`one of ${ACTIVATE_MODES.map((mode) => `"${mode}"`).join(", ")}`,
			value,
		);
	}
}
