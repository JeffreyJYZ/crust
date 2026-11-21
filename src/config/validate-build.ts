import { isAbsolute } from "node:path";
import { resolveSidecar } from "@/plugins/sidecar";
import { isContainedRelative } from "./path-rule.ts";
import type { Validator } from "./validator.ts";

export const BUILD_KEYS = [
	"beforeBuildCommand",
	"assets",
	"minimumSystemVersion",
	"urlScheme",
	"sidecars",
] as const;

export function validateBuild(v: Validator, value: unknown): void {
	if (value === undefined) return;
	const build = v.object("build", value);
	if (!build) return;
	v.only(build, "build", BUILD_KEYS);
	v.string(build, "beforeBuildCommand", "build", false);
	const assets = v.string(build, "assets", "build", false);
	if (assets !== undefined && !isContainedRelative(assets)) {
		// resolveAssets joins this onto the project and embeds everything under it: an absolute
		// value or a `..` climb would ship files the project never declared.
		v.fail("build.assets", "a relative path inside the project, with no '..' segments", assets);
	}
	v.string(build, "minimumSystemVersion", "build", false);
	v.string(build, "urlScheme", "build", false);
	const sidecars = v.stringArray(build, "sidecars", "build");
	if (!sidecars) return;
	for (const [index, entry] of sidecars.entries()) {
		const path = `build.sidecars[${index}]`;
		// A sidecar must be a relative path inside the project. An absolute path would
		// ship whatever happened to sit at that location on the build machine.
		const windowsAbsolute = /^[A-Za-z]:[\\/]/.test(entry) || entry.startsWith("\\\\");
		if (isAbsolute(entry) || windowsAbsolute || resolveSidecar("", entry) === undefined) {
			v.fail(path, "a relative path inside the project (no '..' or '.' segments)", entry);
		}
	}
}
