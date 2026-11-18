/**
 * A Linux AppImage: an AppDir assembled here, then packed by `appimagetool`.
 * The AppDir is the useful half — a caller without `appimagetool` still gets a tree that runs, and the honest answer is "install appimagetool", never a download.
 * No FUSE path and no runtime stub of our own: writing a squashfs image by hand would mean shipping a second AppImage runtime.
 */

import { chmod, cp, mkdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { formatBytes } from "./build";
import { run } from "./exec";
import { findInstallerSidecars, stageSidecars } from "./installers-sidecars";

/** The command runner, injectable so a test needs no tool installed. */
export type Exec = typeof run;

export interface AppImageOptions {
	/** Directory holding the built Linux binary, e.g. `dist`. */
	appPath: string;
	/** Executable filename inside `appPath`, and the `Exec` in the entry. */
	binaryName: string;
	/** Reverse-DNS identifier; names the `.desktop`, the icon and the AppDir. */
	id: string;
	/** Human name, the only string a Linux menu shows. */
	name: string;
	/** Short version, e.g. `0.1.0`. */
	version: string;
	/** A 512×512 PNG. Copied as-is: the build machine resamples nothing. */
	iconPath: string;
	/** Destination `.AppImage`. Defaults to `<appPath>/<id>-<version>.AppImage`. */
	out?: string;
	exec?: Exec;
}

export interface AppImageBuilt {
	ok: true;
	path: string;
	bytes: number;
	/** The tool that packed it, by filename, as `which` resolved it. */
	tool: string;
	/** The staged AppDir, kept so a caller can inspect or repack it. */
	appDir: string;
}

export interface AppImageMissing {
	ok: false;
	reason: string;
	requires: string;
	appDir: string;
}

export type AppImageResult = AppImageBuilt | AppImageMissing;

/** `AppRun` is the AppImage's entry point; `$@` forwards the caller's arguments. */
export function appRun(binaryName: string): string {
	return `#!/bin/sh\nexec "$(dirname "$0")/usr/bin/${binaryName}" "$@"\n`;
}

/** The freedesktop entry, in the order a menu reads it. Exact, because a typo here hides the app. */
export function desktopEntry(options: { id: string; name: string; binaryName: string }): string {
	return [
		"[Desktop Entry]",
		"Type=Application",
		`Name=${options.name}`,
		`Exec=${options.binaryName}`,
		`Icon=${options.id}`,
		"Categories=Utility;",
		"Terminal=false",
		"",
	].join("\n");
}

async function toolOnPath(exec: Exec, tool: string): Promise<string | undefined> {
	const result = await exec(["which", tool]);
	const found = result.stdout.trim();
	return result.code === 0 && found !== "" ? found : undefined;
}

/**
 * Assemble `AppDir` and pack it. Throws when the binary or icon is absent — that is a caller mistake, not a missing tool — and returns `ok: false` only for the one condition a person can fix by installing something.
 */
export async function buildAppImage(options: AppImageOptions): Promise<AppImageResult> {
	const source = join(options.appPath, options.binaryName);
	const sourceStat = await stat(source).catch(() => undefined);
	if (!sourceStat?.isFile()) {
		throw new Error(`binary ${source} does not exist; run the build step first`);
	}
	const iconStat = await stat(options.iconPath).catch(() => undefined);
	if (!iconStat?.isFile()) {
		throw new Error(`icon ${options.iconPath} does not exist`);
	}

	// Default beside the binary, inside `appPath`: the AppImage is build output,
	// and a default that wrote to the project root would surprise a first run.
	const appImagePath = resolve(
		options.out ?? join(options.appPath, `${options.id}-${options.version}.AppImage`),
	);
	const appDir = join(resolve(appImagePath, ".."), `${options.id}.AppDir`);
	// A stale AppDir keeps files a rename or a removed asset left behind, and
	// appimagetool would pack them into an image that looks correct.
	await rm(appDir, { recursive: true, force: true });

	const binDir = join(appDir, "usr", "bin");
	const applications = join(appDir, "usr", "share", "applications");
	const iconDir = join(appDir, "usr", "share", "icons", "hicolor", "512x512", "apps");
	await mkdir(binDir, { recursive: true });
	await mkdir(applications, { recursive: true });
	await mkdir(iconDir, { recursive: true });

	const target = join(binDir, options.binaryName);
	await cp(source, target);
	await chmod(target, 0o755);

	// Same names, modes and manifest as the built bundle: the sidecar plugin looks next to
	// the executable, which in an AppImage is AppDir/usr/bin, not the project's dist dir.
	const sidecars = await findInstallerSidecars(options.appPath);
	await stageSidecars(sidecars, binDir);

	const desktop = `${options.id}.desktop`;
	await writeFile(join(applications, desktop), desktopEntry(options), "utf8");
	// The top-level copy is what `appimagetool` reads when it asks for the entry.
	await symlink(join("usr", "share", "applications", desktop), join(appDir, desktop));

	await cp(options.iconPath, join(iconDir, `${options.id}.png`));
	// The AppDir spec lists `.DirIcon` and a root `<Icon>.png` among the entries that
	// MUST be present, and `appimagetool` registers both as critical: it looks for
	// `<source>/<icon_name>.png` at the AppDir root (appimagetool.c:1093-1095) and
	// warns that "`.DirIcon` does not exist, and no <id>.png … was found in the top
	// level" (:398-401). Without them the image ships with no thumbnail, and a future
	// appimagetool refuses the build outright.
	await cp(options.iconPath, join(appDir, `${options.id}.png`));
	await cp(options.iconPath, join(appDir, ".DirIcon"));

	const appRunPath = join(appDir, "AppRun");
	await writeFile(appRunPath, appRun(options.binaryName), "utf8");
	await chmod(appRunPath, 0o755);

	const exec = options.exec ?? run;
	const tool = await toolOnPath(exec, "appimagetool");
	if (!tool) {
		return {
			ok: false,
			reason: "appimagetool is not on PATH",
			requires: "appimagetool",
			appDir,
		};
	}

	await rm(appImagePath, { force: true });
	// `--no-appstream` skips the metadata validator, which a minimal AppDir has
	// no appstream file for; without it the pack fails rather than warns.
	const packed = await exec([tool, "--no-appstream", appDir, appImagePath]);
	if (packed.code !== 0) {
		const detail = (packed.stderr.trim() || packed.stdout.trim() || "no output")
			.split("\n")
			.join(" | ");
		throw new Error(`appimagetool failed (exit ${packed.code}): ${detail}`);
	}

	const bytes = (await stat(appImagePath)).size;
	return { ok: true, path: appImagePath, bytes, tool: basename(tool), appDir };
}

/** One line a CLI can print without inventing a second size format. */
export function describeAppImage(result: AppImageResult): string {
	if (!result.ok) {
		return `appimage  unavailable  ${result.reason}; install ${result.requires} (AppDir ${result.appDir})`;
	}
	return `appimage ${formatBytes(result.bytes).padStart(9)}  ${result.bytes} bytes  ${result.path}  (${result.tool})`;
}
