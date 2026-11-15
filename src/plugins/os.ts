/**
 * `crust:os` — what the machine actually reports: platform, architecture, family, hostname, the macOS product version, the app's own version, uptime, and the user's preferred language. Nothing here is a constant, and nothing is guessed: the three facts Bun reads (`process.platform`, `process.arch`, `hostname()`) come from `uname`, and the rest arrive through the adapter, which on macOS is `NSProcessInfo`/`NSLocale`/`NSBundle`.
 * `paths` answers the four directories a page needs, computed by the same function `crust:logging` uses, so `appLog` is where the sink really writes.
 * Every command answers a plain object; a failure is `{ ok: false, code, message }` and an adapter that throws becomes `handler-error` rather than a rejected invoke.
 */

import { hostname, tmpdir } from "node:os";
import { definePlugin, notImplemented, type NotImplemented, type PluginDefinition } from "./define";
import { logDirs } from "./logging";

export interface OsInfoResult {
	ok: true;
	/** `process.platform`, e.g. `"darwin"`. */
	platform: string;
	/** `process.arch`, i.e. `uname -m`, e.g. `"arm64"`. */
	arch: string;
	/** The OS family Tauri names, e.g. `"macOS"` — not the kernel name in {@link platform}. */
	family: string;
	/** The suffix an executable carries, `""` everywhere but Windows. */
	exeExtension: string;
	/** `hostname()`, as the kernel reports it. */
	hostname: string;
	/** The OS product version, e.g. `"27.0.1"`. */
	version: string;
	/** `CFBundleShortVersionString`, or null when the process carries no bundle. */
	appVersion: string | null;
	/** Seconds since boot, from `-[NSProcessInfo systemUptime]`. */
	uptime: number;
}

export interface OsPathsResult {
	ok: true;
	/** The user's home directory. */
	home: string;
	/** The per-app data root, `~/Library/Application Support/<appId>` by default. */
	appData: string;
	/** The directory `crust:logging` writes `app.log` into. */
	appLog: string;
	/** The system temp directory. */
	temp: string;
}

export interface OsLocaleResult {
	ok: true;
	/** A BCP-47 identifier such as `"en-GB"`. */
	locale: string;
}

export interface OsFailure {
	ok: false;
	code: "handler-error";
	message: string;
}

/**
 * The native half of `crust:os`. Four reads, because the OS is the only place they exist: a
 * platform without them answers `not-implemented` instead of inventing a version.
 */
export interface OsAdapter {
	/** The OS product version, e.g. `"27.0.1"`. */
	systemVersion(): string | Promise<string>;
	/** The user's preferred language identifier, e.g. `"en-GB"`. */
	locale(): string | Promise<string>;
	/** The app's own version, or null when the process carries no bundle. */
	appVersion(): string | null | Promise<string | null>;
	/** Seconds since boot, from `-[NSProcessInfo systemUptime]`. */
	uptime(): number | Promise<number>;
	/** Bundle id naming the default data root; `crust:logging` defaults to the same one. */
	appId?: string;
	/** Home override, so a test can point both sinks at one temp tree. */
	home?: string;
	/** Data root override, which wins over `home` and `appId` exactly as logging's does. */
	root?: string;
}

/** Tauri names the family, not the kernel: `darwin` is `macOS` and `win32` is `Windows_NT`. */
const FAMILY: Record<string, string> = { darwin: "macOS", linux: "Linux", win32: "Windows_NT" };

export function osFamily(platform: string): string {
	return FAMILY[platform] ?? platform;
}

/** The extension an executable carries on this platform, `""` where binaries have none. */
export function exeExtension(platform: string): string {
	return platform === "win32" ? ".exe" : "";
}

function failure(message: string): OsFailure {
	return { ok: false, code: "handler-error", message };
}

function describe(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export function createOsPlugin(adapter?: OsAdapter): PluginDefinition<
	"os",
	{
		info: () => Promise<OsInfoResult | OsFailure | NotImplemented>;
		locale: () => Promise<OsLocaleResult | OsFailure | NotImplemented>;
		paths: () => OsPathsResult;
	}
> {
	const native = adapter;
	const missing = (command: string) =>
		notImplemented(
			`os.${command} needs NSProcessInfo, NSLocale and NSBundle, which only AppKit and Foundation provide. Pass an OsAdapter to createOsPlugin on a platform that has none.`,
			"NSProcessInfo",
		);

	return definePlugin({
		name: "os",
		commands: {
			/**
			 * The whole identity of this process in one call. `platform`, `arch`, `family`,
			 * `exeExtension` and `hostname` are read here rather than through the adapter, because
			 * every platform has them; only the product version, the bundle version and uptime need
			 * the native half.
			 */
			info: async (): Promise<OsInfoResult | OsFailure | NotImplemented> => {
				if (!native) return missing("info");
				try {
					return {
						ok: true,
						platform: process.platform,
						arch: process.arch,
						family: osFamily(process.platform),
						exeExtension: exeExtension(process.platform),
						hostname: hostname(),
						version: await native.systemVersion(),
						appVersion: await native.appVersion(),
						uptime: await native.uptime(),
					};
				} catch (error) {
					return failure(`os.info: ${describe(error)}`);
				}
			},
			/**
			 * The four directories, read through the same `logDirs` the sink uses. No native half is
			 * needed, so this answers on every platform rather than `not-implemented`.
			 */
			paths: (): OsPathsResult => {
				const dirs = logDirs({ appId: native?.appId, home: native?.home, root: native?.root });
				return {
					ok: true,
					home: dirs.home,
					appData: dirs.root,
					appLog: dirs.logs,
					temp: tmpdir(),
				};
			},
			/** The language macOS resolved for this user, which is what a page should format dates in. */
			locale: async (): Promise<OsLocaleResult | OsFailure | NotImplemented> => {
				if (!native) return missing("locale");
				try {
					return { ok: true, locale: await native.locale() };
				} catch (error) {
					return failure(`os.locale: ${describe(error)}`);
				}
			},
		},
	});
}

/** The default registration: honest about the missing framework. */
export const osPlugin = createOsPlugin();
