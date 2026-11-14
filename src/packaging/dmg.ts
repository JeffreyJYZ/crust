/**
 * A drag-to-Applications disk image, built with `diskutil image create from` — the supported path on macOS 27 — falling back to `hdiutil create -srcfolder`, which is deprecated there and was measured failing "No space left on device" on a volume with 40 GiB free.
 * No Finder scripting, deliberately: an AppleScript window layout needs Finder running, Automation consent on the build machine, and fails silently in CI. The cost is that the icon opens wherever Finder likes; a layout pass belongs behind an opt-in flag.
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
 * Stage the app beside an `/Applications` symlink and compress that folder. The symlink is the drag-to-Applications convention: the mounted image shows the app and the destination, and one drag copies it. It is the absolute path, so it survives mounting at any volume path.
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
		// `diskutil image create from` is the supported path on macOS 27.
		// `hdiutil create -srcfolder` is deprecated there and was measured failing
		// with "No space left on device" on a volume holding 40 GiB free, so it is
		// only the fallback for an older system.
		try {
			await runOrThrow([
				"diskutil",
				"image",
				"create",
				"from",
				"--format",
				"UDZO",
				"--volumeName",
				volumeName,
				stage,
				dmgPath,
			]);
		} catch {
			await rm(dmgPath, { force: true });
			// `-ov` overwrites an existing image at the same path; `UDZO` is the
			// compressed read-only format every download ships in.
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
		}
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
