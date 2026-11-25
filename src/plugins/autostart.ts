/**
 * `crust:autostart` — launch at login, the half of Tauri's autostart plugin crust lacked.
 *
 * Each OS gets its own mechanism, because one OS's file starts nothing on another: a LaunchAgent
 * plist on macOS (`autostart-macos.ts`), an XDG autostart entry on Linux (`autostart-linux.ts`).
 * Both are read back from disk, so `isEnabled` answers what is really armed rather than what a
 * previous `enable` asked for, and `disable` answers `enabled: false` only once the file is gone.
 *
 * Windows is refused by name. Its login item is a value under
 * `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`, and this build writes no Win32 registry
 * entry — an earlier revision answered `{ ok: true, enabled: true }` there while writing a macOS
 * plist Windows never reads, which told an app it would start at login when it would not. A refusal
 * a caller can branch on is the honest answer until that registry half exists.
 */

import { mkdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import { linuxMechanism } from "./autostart-linux";
import { macosMechanism } from "./autostart-macos";
import { type AutostartMechanism, exists, reasonOf } from "./autostart-mechanism";
import type {
	AutostartAdapter,
	AutostartFailure,
	AutostartFailureCode,
	AutostartIdArgs,
	AutostartResult,
	EnableArgs,
} from "./autostart-types";
import { definePlugin } from "./define";

/**
 * The typed answer lives in `autostart-types.ts` and is re-exported here, so every caller keeps
 * importing it from the plugin.
 */
export type {
	AutostartAdapter,
	AutostartFailure,
	AutostartFailureCode,
	AutostartIdArgs,
	AutostartResult,
	AutostartStatus,
	EnableArgs,
} from "./autostart-types";

/** The OSes with a mechanism here; anything else is refused rather than guessed at. */
const MECHANISMS = new Set(["darwin", "linux"]);

function fail(code: AutostartFailureCode, message: string): AutostartFailure {
	return { ok: false, code, message };
}

/**
 * The refusal for a platform with no mechanism. It names the real one, because "not supported" with
 * no reason is what makes a caller assume the feature nearly worked.
 */
function unsupported(command: string, platform: string): AutostartFailure {
	return fail(
		"unsupported-platform",
		`autostart.${command}: launch at login on ${platform} needs a value under ` +
			"HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run, and this build writes no Win32 " +
			"registry entry; crust arms a LaunchAgent on macOS and an XDG autostart entry on Linux, " +
			"so nothing would start at login here",
	);
}

/** An id becomes a file name, so one that could leave its directory is refused, not sanitised. */
function invalidId(command: string, bundleId: string): AutostartFailure | undefined {
	const safe = bundleId.length > 0 && !/[/\\\0]/.test(bundleId);
	if (safe && bundleId !== "." && bundleId !== "..") return undefined;
	return fail(
		"bad-request",
		`autostart.${command}: "${bundleId}" is not a usable bundle id; it names a file, so it may not hold a path separator`,
	);
}

const BUNDLE_ID = /<key>CFBundleIdentifier<\/key>\s*<string>([^<]+)<\/string>/;

/** The id an app bundle declares, so a caller does not have to repeat it. */
async function bundleIdFromApp(appPath: string): Promise<string | undefined> {
	const info = appPath.endsWith(".app")
		? join(appPath, "Contents", "Info.plist")
		: join(appPath, "Info.plist");
	const text = await readFile(info, "utf8").catch(() => undefined);
	return text === undefined ? undefined : BUNDLE_ID.exec(text)?.[1];
}

export function createAutostartPlugin(adapter: AutostartAdapter = { home: homedir() }) {
	/** The id the last `enable` used, so `disable`/`isEnabled` need no argument after one call. */
	let known: string | undefined;
	const platform = adapter.platform ?? process.platform;
	const configHome = adapter.configHome ?? join(adapter.home, ".config");

	const resolveId = (given?: string): string | undefined => given ?? adapter.bundleId ?? known;

	const unknownId = (command: string): AutostartFailure =>
		fail(
			"bad-request",
			`autostart.${command}: no bundle id known; pass bundleId, or call enable with the app path first`,
		);

	/** This OS's mechanism; the caller has already refused a platform that has none. */
	const mechanismFor = (bundleId: string): AutostartMechanism =>
		platform === "linux"
			? linuxMechanism(configHome, bundleId)
			: macosMechanism(adapter.home, bundleId);

	return definePlugin({
		name: "autostart",
		commands: {
			enable: async (args: EnableArgs | undefined): Promise<AutostartResult> => {
				const appPath = args?.appPath;
				if (typeof appPath !== "string" || appPath.length === 0) {
					return fail(
						"bad-request",
						'autostart.enable: "appPath" must be a non-empty string',
					);
				}
				if (!MECHANISMS.has(platform)) return unsupported("enable", platform);
				const present = await exists(appPath);
				if (!present) return fail("not-found", `autostart.enable: no app at ${appPath}`);
				// A directory that is not a `.app` would be handed to `execve` as-is and fail at login.
				// Bundles are launched through `/usr/bin/open`; any other directory has no launch form.
				const info = await stat(appPath);
				if (info.isDirectory() && !appPath.endsWith(".app")) {
					return fail(
						"bad-request",
						`autostart.enable: ${appPath} is a directory but not a .app bundle; pass the executable inside it or the bundle itself`,
					);
				}
				const bundleId = resolveId(args?.bundleId) ?? (await bundleIdFromApp(appPath));
				if (bundleId === undefined) {
					return fail(
						"bad-request",
						`autostart.enable: no bundle id for ${appPath}; pass bundleId, or give the app a CFBundleIdentifier in its Info.plist`,
					);
				}
				const unusable = invalidId("enable", bundleId);
				if (unusable !== undefined) return unusable;
				const entry = mechanismFor(bundleId);
				try {
					await mkdir(dirname(entry.path), { recursive: true });
					await entry.write(appPath);
					// Read the mechanism back as launchd would: an entry that exists but names a
					// directory as its executable is not armed, however complete the file looks.
					if (!(await entry.enabled())) {
						return fail(
							"handler-error",
							`autostart.enable: ${entry.path} does not name a launchable executable after the write`,
						);
					}
				} catch (error) {
					return fail("handler-error", `autostart.enable: ${reasonOf(error)}`);
				}
				known = bundleId;
				return { ok: true, enabled: true, path: entry.path };
			},
			disable: async (args: AutostartIdArgs | undefined): Promise<AutostartResult> => {
				if (!MECHANISMS.has(platform)) return unsupported("disable", platform);
				const bundleId = resolveId(args?.bundleId);
				if (bundleId === undefined) return unknownId("disable");
				const unusable = invalidId("disable", bundleId);
				if (unusable !== undefined) return unusable;
				const entry = mechanismFor(bundleId);
				try {
					await entry.remove();
					if (await exists(entry.path)) {
						return fail(
							"handler-error",
							`autostart.disable: ${entry.path} is still there after the delete`,
						);
					}
				} catch (error) {
					return fail("handler-error", `autostart.disable: ${reasonOf(error)}`);
				}
				return { ok: true, enabled: false, path: entry.path };
			},
			isEnabled: async (args: AutostartIdArgs | undefined): Promise<AutostartResult> => {
				if (!MECHANISMS.has(platform)) return unsupported("isEnabled", platform);
				const bundleId = resolveId(args?.bundleId);
				if (bundleId === undefined) return unknownId("isEnabled");
				const unusable = invalidId("isEnabled", bundleId);
				if (unusable !== undefined) return unusable;
				const entry = mechanismFor(bundleId);
				return { ok: true, enabled: await entry.enabled(), path: entry.path };
			},
		},
	});
}

/** The default registration: the real `~/Library/LaunchAgents` or `~/.config/autostart` for this OS. */
export const autostartPlugin = createAutostartPlugin();
