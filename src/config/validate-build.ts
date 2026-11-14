import type { Validator } from "./validator.ts";

export const BUILD_KEYS = ["beforeBuildCommand", "assets", "minimumSystemVersion"] as const;

export function validateBuild(v: Validator, value: unknown): void {
	if (value === undefined) return;
	const build = v.object("build", value);
	if (!build) return;
	v.only(build, "build", BUILD_KEYS);
	v.string(build, "beforeBuildCommand", "build", false);
	v.string(build, "assets", "build", false);
	v.string(build, "minimumSystemVersion", "build", false);
}
