/**
 * Where sidecar binaries live and what names were declared. Shared by the plugin at runtime, the
 * config validator and `crust build` when it copies the files and writes the manifest.
 */

import { readFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve, sep } from "node:path";

/** Name of the manifest `crust build` writes beside the binary, listing every declared sidecar. */
export const SIDECAR_MANIFEST = "crust-sidecars.json";

/**
 * Read the declared names from the build manifest; a missing or corrupt manifest declares none.
 *
 * macOS keeps it in `Contents/Resources`, not `Contents/MacOS`: codesign treats every file beside
 * the executable as nested code, and a JSON document there fails the ad-hoc sign with "code object
 * is not signed at all". The executable's own directory is still searched first, so Linux and
 * Windows (a flat directory) and an older bundle keep working.
 */
export function declaredSidecars(dir: string): string[] {
	for (const candidate of [join(dir, SIDECAR_MANIFEST), join(dir, "..", "Resources", SIDECAR_MANIFEST)]) {
		try {
			const value: unknown = JSON.parse(readFileSync(candidate, "utf8"));
			return Array.isArray(value)
				? value.filter((name): name is string => typeof name === "string")
				: [];
		} catch {
			// Try the next location; a missing manifest is "declares none", not an error.
		}
	}
	return [];
}

/** A compiled binary carries its sidecars beside it; a dev process uses the project (cwd). */
export function defaultSidecarDir(): string {
	const named = process.env.CRUST_SIDECARS_DIR;
	if (named) return resolve(named);
	const executable = basename(process.execPath).toLowerCase();
	const compiled = !/^(bun|node|deno)(\.exe)?$/.test(executable);
	return compiled ? dirname(process.execPath) : process.cwd();
}

/** A declared name is a relative project path; no absolute paths and no `..` segments. */
export function resolveSidecar(dir: string, name: string): string | undefined {
	if (typeof name !== "string" || name.length === 0 || isAbsolute(name)) return undefined;
	const parts = name.split(/[\\/]/);
	if (parts.includes("..") || parts.includes(".")) return undefined;
	const root = resolve(dir);
	const target = resolve(root, ...parts);
	if (target !== root && !target.startsWith(`${root}${sep}`)) return undefined;
	return target;
}
