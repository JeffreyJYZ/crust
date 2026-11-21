import type { WindowMaterial } from "./types.ts";
import type { Validator } from "./validator.ts";

export const WINDOW_KEYS = [
	"label",
	"url",
	"width",
	"height",
	"minWidth",
	"minHeight",
	"title",
	"material",
] as const;

/** Which backdrops a platform can apply. Linux has none, so it refuses any named material. */
export function allowedWindowMaterials(platform: NodeJS.Platform): readonly WindowMaterial[] {
	if (platform === "darwin") return ["none", "vibrancy"];
	if (platform === "win32") return ["none", "mica", "acrylic", "tabbed"];
	return ["none"];
}

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

	const seen = new Set<string>();
	value.forEach((item, index) => {
		const path = `windows[${index}]`;
		const window = v.object(path, item);
		if (!window) return;
		v.only(window, path, WINDOW_KEYS);
		const label = v.string(window, "label", path, true);
		if (label !== undefined) {
			// Labels are window handles and grant-table keys. A duplicate crashes the native
			// adapter on the second create, after the first window is already open.
			if (seen.has(label)) v.fail(`${path}.label`, "a label no other window uses", label);
			seen.add(label);
		}
		v.string(window, "url", path, false);
		v.positiveInteger(window, "width", path);
		v.positiveInteger(window, "height", path);
		v.positiveInteger(window, "minWidth", path);
		v.positiveInteger(window, "minHeight", path);
		v.string(window, "title", path, false);
		const allowed = allowedWindowMaterials(process.platform);
		const material = window.material;
		if (material !== undefined) {
			if (typeof material !== "string" || !allowed.includes(material as WindowMaterial)) {
				v.fail(
					`${path}.material`,
					`one of ${allowed.map((name) => `"${name}"`).join(", ")} on ${process.platform}`,
					material,
				);
			}
		}
	});
}
