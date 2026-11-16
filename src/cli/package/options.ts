/**
 * The inputs each artefact builder takes, derived from one loaded config and the
 * bundle `crust dmg` already finds. Pure: nothing here stats, spawns or writes.
 */

import { resolve } from "node:path";
import type { CrustConfig } from "@/config";
import type { AppImageOptions, Exec as AppImageExec } from "@/packaging/appimage";
import type { DmgOptions } from "@/packaging/dmg";
import type { NsisOptions } from "@/packaging/nsis";

/**
 * `crust build` writes `dist/crust-app` and names it again inside the bundle, so
 * the Linux and Windows artefacts carry that same executable name.
 */
export const BINARY_NAME = "crust-app";

export interface PackageInputs {
	/** Project directory. */
	dir: string;
	config: CrustConfig;
	/** The assembled `.app` `findAppBundle` found. */
	bundle: string;
	/** The directory holding the built binary, which is the bundle's parent. */
	dist: string;
	/** Absolute icon path, set only when `app.icon` names a file that exists. */
	iconPath?: string;
}

export function dmgOptions(inputs: PackageInputs): DmgOptions {
	const { name, version } = inputs.config.app;
	return {
		appPath: inputs.bundle,
		out: resolve(inputs.dir, `dist/${name}-${version}.dmg`),
		volumeName: name,
	};
}

/** `iconPath` is required here, so the caller cannot reach the builder without one. */
export function appImageOptions(
	inputs: PackageInputs,
	iconPath: string,
	exec?: AppImageExec,
): AppImageOptions {
	const { id, name, version } = inputs.config.app;
	return {
		appPath: inputs.dist,
		binaryName: BINARY_NAME,
		id,
		name,
		version,
		iconPath,
		exec,
	};
}

export function nsisOptions(inputs: PackageInputs, exec?: AppImageExec): NsisOptions {
	const { id, name, version } = inputs.config.app;
	return {
		appPath: inputs.dist,
		binaryName: `${BINARY_NAME}.exe`,
		id,
		name,
		version,
		exec,
	};
}
