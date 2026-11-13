/**
 * A drag-to-Applications disk image, built with `hdiutil` alone.
 *
 * No Finder scripting, and that is a deliberate limit rather than an oversight:
 * an AppleScript-passed window layout (icon positions, a background picture,
 * a fixed window size) needs Finder to be running, needs Automation consent on
 * the build machine, and fails silently in CI. `hdiutil create -srcfolder` is
 * deterministic and needs no GUI session at all. The cost is real: the mounted
 * image opens with the icon wherever Finder feels like putting it. Adding the
 * layout later is a Finder-scripting pass over the mounted volume, and it
 * belongs behind an opt-in flag, not in the default build.
 */

import { cp, mkdir, mkdtemp, rm, stat, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { formatBytes } from "./build";
import { runOrThrow } from "./exec";

export interface DmgOptions {
	/** Path to the assembled `.app`. */
	appPath: string;
	/** Destination `.dmg`. Defaults to `<appDir>/<name>.dmg`. */
	out?: string;
	/** Volume name shown when the image is mounted. Defaults to the app's name. */
	volumeName?: string;
}

export interface DmgResult {
	dmgPath: string;
	bytes: number;
	volumeName: string;
}

/**
 * Stage the app beside an `/Applications` symlink and compress that folder.
 *
 * The symlink is the whole point of the "drag-to-Applications" convention: the
 * mounted image shows the app and a shortcut to the install destination, and a
 * single drag does the copy. It points at the absolute path `/Applications`, so
 * it survives mounting at any volume path.
 */
export async function buildDmg(options: DmgOptions): Promise<DmgResult> {
	const appStat = await stat(options.appPath).catch(() => undefined);
	if (!appStat?.isDirectory()) {
		throw new Error(
			`app bundle ${options.appPath} does not exist; run the build and sign steps first`,
		);
	}

	const appName = basename(options.appPath);
	const volumeName = options.volumeName ?? appName.replace(/\.app$/, "");
	const dmgPath = resolve(
		options.out ?? join(resolve(options.appPath, ".."), `${volumeName}.dmg`),
	);

	const stage = await mkdtemp(join(tmpdir(), "crust-dmg-"));
	try {
		await cp(options.appPath, join(stage, appName), { recursive: true });
		await symlink("/Applications", join(stage, "Applications"));

		await mkdir(resolve(dmgPath, ".."), { recursive: true });
		// `-ov` overwrites an existing image at the same path; `UDZO` is the
		// compressed read-only format every download ships in. `-srcfolder`
		// copies the staging tree and nothing else — no stray files.
		await runOrThrow([
			"hdiutil",
			"create",
			"-volname",
			volumeName,
			"-srcfolder",
			stage,
			"-ov",
			"-format",
			"UDZO",
			dmgPath,
		]);
	} finally {
		// The stage holds a second copy of an 85 MiB bundle; leaving it behind
		// doubles the disk cost of every dmg build.
		await rm(stage, { recursive: true, force: true });
	}

	const bytes = (await stat(dmgPath)).size;
	return { dmgPath, bytes, volumeName };
}

/** One line a CLI can print without inventing a second size format. */
export function describeDmg(result: DmgResult): string {
	return `dmg ${formatBytes(result.bytes).padStart(9)}  ${result.bytes} bytes  ${result.dmgPath}`;
}
