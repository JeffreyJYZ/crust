/**
 * Assemble an `.app` bundle around a compiled Bun binary — the layout `site/app/docs/design/page.mdx` specifies, which launched in the probe (`research/packaging.md` §3): `Contents/{Info.plist,PkgInfo,MacOS/<binary>,Resources/icon.icns}`.
 * The `.app` is the shipping unit, not the binary: a bare Mach-O is not double-clickable and, when quarantined, is killed with SIGKILL 137 and no message at all (`research/packaging.md` §6). Plist body and key lists in `plist.ts`.
 */

import { chmod, copyFile, mkdir, mkdtemp, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { allocatedKiB } from "./exec";
import { pngToIcns } from "./icon";
import { infoPlist, PKG_INFO } from "./plist";

export * from "./plist.ts";

/**
 * Only macOS ships an `.app` bundle. Windows and Linux ship the flat compiled binary;
 * assembling a bundle there doubles the output and prints a macOS `open` instruction on
 * a host that has none. Pure so a non-darwin build is assertable on a darwin machine.
 */
export function bundlesApp(platform: NodeJS.Platform): boolean {
	return platform === "darwin";
}

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
	/**
	 * A custom URL scheme to register in `Info.plist`. When set, macOS routes
	 * `<scheme>://…` links to this bundle and the app delegate hears them; absent
	 * leaves `CFBundleURLTypes` out entirely, so no link is ever routed here.
	 */
	urlScheme?: string;
	/** `security.microphone`: the purpose sentence, written as `NSMicrophoneUsageDescription`. */
	microphone?: string;
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
 * Build `X.app` around `binary`. Idempotent — an existing bundle at the same path is replaced — and it never signs, which is what lets the build step be re-run without re-signing.
 */
export async function assembleApp(options: AssembleAppOptions): Promise<AssembledApp> {
	const outDir = resolve(options.outDir ?? "dist");
	const bundleName = options.name.endsWith(".app") ? options.name : `${options.name}.app`;
	const appPath = join(outDir, bundleName);
	// Build in a sibling staging dir. A failed icon conversion must not leave a partial
	// .app that a later `package` or `doctor` would certify, and must not destroy the
	// previous valid bundle either.
	await mkdir(outDir, { recursive: true });
	const staging = await mkdtemp(join(outDir, `.${bundleName}-`));
	const staged = join(staging, bundleName);
	const contents = join(staged, "Contents");
	const macos = join(contents, "MacOS");
	const resources = join(contents, "Resources");

	const executableName = basename(options.binary);
	if (!executableName) {
		throw new Error(
			`binary path ${options.binary} has no filename — pass a path ending in a file name, e.g. dist/crust-app`,
		);
	}

	const sourceStat = await stat(options.binary).catch(() => undefined);
	if (!sourceStat?.isFile()) {
		throw new Error(`binary ${options.binary} does not exist; run the compile step first`);
	}

	try {
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
				throw new Error(
					`icon ${options.iconPath} does not exist — create the PNG or fix app.icon in crust.config.ts`,
				);
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
				urlScheme: options.urlScheme,
				microphone: options.microphone,
			}),
			"utf8",
		);

		const binaryBytes = (await stat(executablePath)).size;
		// Only a complete bundle replaces the previous one. A failure anywhere above
		// leaves the old .app untouched and no partial artefact for package/doctor to find.
		await rm(appPath, { recursive: true, force: true });
		await rename(staged, appPath);
		const assembledBytes = (await allocatedKiB(appPath)) * 1024;
		return {
			appPath,
			executableName,
			executablePath: join(appPath, "Contents", "MacOS", executableName),
			binaryBytes,
			assembledBytes,
		};
	} catch (error) {
		await rm(staging, { recursive: true, force: true });
		throw error;
	} finally {
		await rm(staging, { recursive: true, force: true }).catch(() => undefined);
	}
}
