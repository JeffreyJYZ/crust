/**
 * Assemble an `.app` bundle around a compiled Bun binary.
 *
 * The layout is the one DESIGN.md §8 specifies, and it is the probe's layout
 * that launched (research/packaging.md §3):
 *
 *   X.app/Contents/Info.plist
 *   X.app/Contents/PkgInfo
 *   X.app/Contents/MacOS/<binary>
 *   X.app/Contents/Resources/icon.icns
 *
 * The `.app` is the shipping unit, not the binary. A bare Mach-O is not
 * double-clickable and, when quarantined, is killed by the kernel with SIGKILL
 * 137 and no message at all (research/packaging.md §6).
 *
 * The plist body and the key lists live in `plist.ts` and are re-exported here,
 * so `./app` stays the one import path.
 */

import { chmod, copyFile, mkdir, rm, stat, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { allocatedKiB } from "./exec";
import { pngToIcns } from "./icon";
import { infoPlist, PKG_INFO } from "./plist";

export * from "./plist.ts";

export interface AssembleAppOptions {
	/** Reverse-DNS bundle identifier, e.g. `land.jyz.example`. */
	id: string;
	/** Human name; also the bundle's filename, `Example` -> `Example.app`. */
	name: string;
	/** Short version, e.g. `0.1.0`. Written to both version keys. */
	version: string;
	/** Path to the `bun build --compile` output. Copied to `Contents/MacOS/`. */
	binary: string;
	/** Optional `.icns` (copied) or `.png` >= 1024px (converted through `sips`). */
	iconPath?: string;
	/** `LSMinimumSystemVersion`, e.g. `13.0`. */
	minimumSystemVersion: string;
	/** Directory the bundle is created in. Defaults to `dist`. */
	outDir?: string;
}

export interface AssembledApp {
	appPath: string;
	executableName: string;
	executablePath: string;
	binaryBytes: number;
	/** Allocated size of the whole bundle, from `du -sk`. */
	assembledBytes: number;
}

/**
 * Build `X.app` around `binary`.
 *
 * Idempotent: an existing bundle at the same path is replaced. Never signs —
 * signing is `sign.ts`, and keeping them apart is what lets the build step be
 * re-run without re-signing.
 */
export async function assembleApp(options: AssembleAppOptions): Promise<AssembledApp> {
	const outDir = resolve(options.outDir ?? "dist");
	const bundleName = options.name.endsWith(".app") ? options.name : `${options.name}.app`;
	const appPath = join(outDir, bundleName);
	const contents = join(appPath, "Contents");
	const macos = join(contents, "MacOS");
	const resources = join(contents, "Resources");

	const executableName = basename(options.binary);
	if (!executableName) {
		throw new Error(`binary path ${options.binary} has no filename`);
	}

	const sourceStat = await stat(options.binary).catch(() => undefined);
	if (!sourceStat?.isFile()) {
		throw new Error(`binary ${options.binary} does not exist; run the compile step first`);
	}

	// `rm -rf` the previous bundle rather than writing over it: a stale
	// Resources/icon.icns or a renamed executable would otherwise survive into
	// the new build and ship inside a bundle that looks correct.
	await mkdir(outDir, { recursive: true });
	await rm(appPath, { recursive: true, force: true });

	await mkdir(macos, { recursive: true });
	await mkdir(resources, { recursive: true });

	const executablePath = join(macos, executableName);
	await copyFile(options.binary, executablePath);
	// `bun build --compile` already emits 0755; a copy preserves the mode, but
	// the bundle is useless if anything ever carries it through a tool that
	// does not, and one chmod is cheaper than diagnosing "does not launch".
	await chmod(executablePath, 0o755);

	await writeFile(join(contents, "PkgInfo"), PKG_INFO, "utf8");

	let hasIcon = false;
	if (options.iconPath) {
		const iconStat = await stat(options.iconPath).catch(() => undefined);
		if (!iconStat?.isFile()) {
			throw new Error(`icon ${options.iconPath} does not exist`);
		}
		const icnsPath = join(resources, "icon.icns");
		if (options.iconPath.toLowerCase().endsWith(".icns")) {
			await copyFile(options.iconPath, icnsPath);
		} else {
			await pngToIcns({ source: options.iconPath, out: icnsPath });
		}
		hasIcon = true;
	}

	await writeFile(
		join(contents, "Info.plist"),
		infoPlist({
			executableName,
			name: options.name.replace(/\.app$/, ""),
			id: options.id,
			version: options.version,
			minimumSystemVersion: options.minimumSystemVersion,
			hasIcon,
		}),
		"utf8",
	);

	const binaryBytes = (await stat(executablePath)).size;
	const assembledBytes = (await allocatedKiB(appPath)) * 1024;

	return { appPath, executableName, executablePath, binaryBytes, assembledBytes };
}
