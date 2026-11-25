/**
 * The installers package the flat `<dist>` tree, but `crust build` ships sidecars inside the
 * `.app` on macOS. Read the manifest from either shape, then hand the same names to build's
 * `copySidecars` so the files, their modes and the manifest an installer ships cannot drift
 * from what a normal bundle carries.
 */

import { readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { declaredSidecars, SIDECAR_MANIFEST } from "@/plugins/sidecar";
import { copySidecars } from "./build";
import { runOrThrow } from "./exec";

export interface InstallerSidecars {
	/** The names the built app declared. */
	names: string[];
	/** The directory holding those files: a flat `dist`, or the bundle's `Contents/MacOS`. */
	sourceDir: string;
}

/**
 * A flat build writes the manifest beside its binary; a macOS build writes it under
 * `Contents/Resources` with the files under `Contents/MacOS`. `declaredSidecars` knows both
 * halves, so hand it the executable's directory and let it find the split manifest.
 */
export async function findInstallerSidecars(dist: string): Promise<InstallerSidecars> {
	const root = resolve(dist);
	const flat = declaredSidecars(root);
	if (flat.length > 0) return { names: flat, sourceDir: root };
	const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
	for (const entry of entries) {
		if (!entry.isDirectory() || !entry.name.endsWith(".app")) continue;
		const macos = join(root, entry.name, "Contents", "MacOS");
		const names = declaredSidecars(macos);
		if (names.length > 0) return { names, sourceDir: macos };
	}
	return { names: [], sourceDir: root };
}

/** Stage into the directory the installer actually packages; a flat build already has the files. */
export async function stageSidecars(found: InstallerSidecars, targetDir: string): Promise<void> {
	if (found.names.length === 0 || resolve(found.sourceDir) === resolve(targetDir)) return;
	await copySidecars({ names: found.names, projectDir: found.sourceDir, targetDir });
}

/**
 * NSIS installs each declared name at its own relative path, plus the manifest the sidecar
 * plugin reads next to the executable. `/oname=` is load-bearing: without it NSIS drops the
 * directory component of an absolute `File` path and `bin/tool.sh` lands at the install root.
 */
/**
 * codesign refuses a bundle seal while a sidecar beside the executable is unsigned ("code object
 * is not signed at all"), so sign each one before `signApp` seals the .app. Kept here so a
 * single-file build does not grow a second copy of the loop `crust build` runs.
 */
export async function signSidecars(
	executablePath: string,
	names: readonly string[],
): Promise<void> {
	if (process.platform !== "darwin" || names.length === 0) return;
	const dir = dirname(executablePath);
	for (const name of names) {
		await runOrThrow([
			"codesign",
			"--force",
			"--sign",
			"-",
			"--timestamp=none",
			join(dir, ...name.split(/[\\/]/)),
		]);
	}
}

/** One `CreateDirectory` per distinct parent, then the `File /oname=` that needs it. */
export function sidecarFileLines(names: readonly string[], appPath: string): string {
	if (names.length === 0) return "";
	const root = resolve(appPath);
	const lines: string[] = [];
	const created = new Set<string>();
	for (const name of names) {
		const parts = name.split(/[\\/]/);
		const parent = parts.slice(0, -1).join("\\");
		// `File /oname=` never creates intermediate directories. Without this the sidecar
		// is copied to an install path that does not exist, and the plugin cannot spawn it.
		if (parent && !created.has(parent)) {
			created.add(parent);
			lines.push(`  CreateDirectory "$INSTDIR\\${parent}"`);
		}
		const oname = parts.join("\\");
		const source = join(root, ...parts);
		lines.push(`  File /oname=${oname} "${source}"`);
	}
	lines.push(`  File "${join(root, SIDECAR_MANIFEST)}"`);
	return `${lines.join("\n")}\n`;
}
