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
 */

import { chmod, copyFile, mkdir, rm, stat, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { allocatedKiB } from "./exec";
import { pngToIcns } from "./icon";

/**
 * String-valued keys `verify-release` insists on. Exported so the verifier and
 * the writer cannot drift: one list, both sides.
 */
export const REQUIRED_PLIST_STRINGS = [
	"CFBundleIdentifier",
	"CFBundleExecutable",
	"CFBundleName",
	"CFBundlePackageType",
	"CFBundleShortVersionString",
	"LSMinimumSystemVersion",
] as const;

/**
 * App Transport Security keys, and the measured reason both ship.
 *
 * `NSAllowsArbitraryLoadsInWebContent` is the key that actually governs a
 * `WKWebView` load over plain http. `NSAllowsLocalNetworking` does *not*
 * reliably cover a bare IP address on macOS 14 and later, so it cannot be
 * substituted — but it is free, it covers the `localhost` case, and it is what
 * Apple documents, so every generated plist carries both.
 */
export const ATS_KEYS = ["NSAllowsArbitraryLoadsInWebContent", "NSAllowsLocalNetworking"] as const;

/** `PkgInfo` is these eight bytes, always. `APPL` is a packaged application. */
export const PKG_INFO = "APPL????";

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

function escapeXml(value: string): string {
	return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * The Info.plist body, as XML.
 *
 * Written by hand rather than through `plutil` or a plist library: it is ~30
 * lines, it needs no round trip, and the output is reviewable in a diff, which
 * is what makes "every required key is present" a code-read rather than a
 * test.
 */
export function infoPlist(options: {
	executableName: string;
	name: string;
	id: string;
	version: string;
	minimumSystemVersion: string;
	/** Whether `Resources/icon.icns` was written. */
	hasIcon: boolean;
}): string {
	return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>CFBundleExecutable</key>
	<string>${escapeXml(options.executableName)}</string>
	<key>CFBundleIdentifier</key>
	<string>${escapeXml(options.id)}</string>
	<key>CFBundleInfoDictionaryVersion</key>
	<string>6.0</string>
	<key>CFBundleName</key>
	<string>${escapeXml(options.name)}</string>
	<key>CFBundlePackageType</key>
	<string>APPL</string>
	<key>CFBundleShortVersionString</key>
	<string>${escapeXml(options.version)}</string>
	<key>CFBundleVersion</key>
	<string>${escapeXml(options.version)}</string>
	<key>LSMinimumSystemVersion</key>
	<string>${escapeXml(options.minimumSystemVersion)}</string>
	<key>NSHighResolutionCapable</key>
	<true/>
	<key>NSAppTransportSecurity</key>
	<dict>
		<key>NSAllowsArbitraryLoadsInWebContent</key>
		<true/>
		<key>NSAllowsLocalNetworking</key>
		<true/>
	</dict>
	${
		options.hasIcon
			? `<key>CFBundleIconFile</key>
	<string>icon.icns</string>
	`
			: ""
	}</dict>
</plist>
`;
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
