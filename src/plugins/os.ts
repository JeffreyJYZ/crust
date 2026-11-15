/**
 * `crust:os` — what the machine actually reports: platform, architecture, hostname, the macOS product version, the app's own version, and the user's preferred language. Nothing here is a constant, and nothing is guessed: the three facts Bun reads (`process.platform`, `process.arch`, `hostname()`) come from `uname`, and the rest arrive through the adapter, which on macOS is `NSProcessInfo`/`NSLocale`/`NSBundle`.
 * Every command answers a plain object; a failure is `{ ok: false, code, message }` and an adapter that throws becomes `handler-error` rather than a rejected invoke.
 */

import { hostname } from "node:os";
import { definePlugin, notImplemented, type NotImplemented, type PluginDefinition } from "./define";

export interface OsInfoResult {
	ok: true;
	/** `process.platform`, e.g. `"darwin"`. */
	platform: string;
	/** `process.arch`, i.e. `uname -m`, e.g. `"arm64"`. */
	arch: string;
	/** `hostname()`, as the kernel reports it. */
	hostname: string;
	/** The OS product version, e.g. `"27.0.1"`. */
	version: string;
	/** `CFBundleShortVersionString`, or null when the process carries no bundle. */
	appVersion: string | null;
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
 * The native half of `crust:os`. Three reads, because the OS is the only place they exist: a
 * platform without them answers `not-implemented` instead of inventing a version.
 */
export interface OsAdapter {
	/** The OS product version, e.g. `"27.0.1"`. */
	systemVersion(): string | Promise<string>;
	/** The user's preferred language identifier, e.g. `"en-GB"`. */
	locale(): string | Promise<string>;
	/** The app's own version, or null when the process carries no bundle. */
	appVersion(): string | null | Promise<string | null>;
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
			 * The whole identity of this process in one call. `platform`, `arch` and `hostname` are
			 * read here rather than through the adapter, because every platform has them; only the
			 * product version and the bundle version need the native half.
			 */
			info: async (): Promise<OsInfoResult | OsFailure | NotImplemented> => {
				if (!native) return missing("info");
				try {
					return {
						ok: true,
						platform: process.platform,
						arch: process.arch,
						hostname: hostname(),
						version: await native.systemVersion(),
						appVersion: await native.appVersion(),
					};
				} catch (error) {
					return failure(`os.info: ${describe(error)}`);
				}
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
