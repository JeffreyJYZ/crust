import type { Validator } from "./validator.ts";

export const WINDOW_KEYS = ["label", "url", "width", "height", "minWidth", "title"] as const;

/** At least one window, and each one names a `label`. */
export function validateWindows(v: Validator, value: unknown): void {
	if (value === undefined) {
		v.fail("windows", "a non-empty array of window objects", undefined);
		return;
	}
	if (!Array.isArray(value) || value.length === 0) {
		v.fail("windows", "a non-empty array of window objects", value);
		return;
	}

	value.forEach((item, index) => {
		const path = `windows[${index}]`;
		const window = v.object(path, item);
		if (!window) return;
		v.only(window, path, WINDOW_KEYS);
		v.string(window, "label", path, true);
		v.string(window, "url", path, false);
		v.positiveInteger(window, "width", path);
		v.positiveInteger(window, "height", path);
		v.positiveInteger(window, "minWidth", path);
		v.string(window, "title", path, false);
	});
}
