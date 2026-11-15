/**
 * `crust:updater`'s command shapes: what each command takes, what it answers, and the {@link UpdaterAdapter} seam that the network, the bundle on disk and the launch sit behind.
 * Nothing here runs anything, so a test can type a fake without touching a filesystem.
 */

import type { UpdaterError } from "./updater-args";

/** The one argument every bundle-touching command shares. */
export interface BundleArgs {
	/** The bundle to act on, e.g. `/Applications/Notes.app`. */
	appPath: string;
}

export interface CheckArgs {
	/** Absolute URL of the JSON manifest. */
	endpoint: string;
	/** The running app's short version, e.g. `1.4.0`. */
	currentVersion: string;
}

export interface DownloadArgs {
	url: string;
	/** Hex, either case; a mismatch is refused before anything is installed. */
	sha256?: string;
	/** Base64 Ed25519 over the artifact bytes; needs `pubkey` or a configured one. */
	signature?: string;
	/** Base64 of 32 raw bytes; a page may omit it when the config pins one. */
	pubkey?: string;
}

/** What a `crust.config.ts` `updater` section becomes: the defaults a page does not have to pass. */
export interface UpdaterOptions {
	/** Manifest URL `check` falls back to when the page passes none. */
	endpoint?: string;
	/** The only key this app accepts; a manifest naming another is refused. */
	pubkey?: string;
	/** Whether the app wants a check at startup; reported by `updater.config`. */
	autoCheck?: boolean;
}

export interface InstallArgs extends BundleArgs {
	/** The downloaded artifact: it must already be an `.app` directory. */
	path: string;
	/** Start the replaced bundle once the swap lands; a launch failure is reported, not rolled back. */
	relaunch?: boolean;
}

export interface DownloadResult {
	readonly ok: true;
	readonly path: string;
	readonly bytes: number;
	/** The digest actually computed, lowercase hex; absent when no hash was asked for. */
	readonly sha256?: string;
}

export interface InstallResult {
	readonly ok: true;
	readonly appPath: string;
	/** Where the replaced bundle went: `<appPath>.old`. */
	readonly backup: string;
	/** Set when the swap landed but the launch did not; the new bundle is still installed. */
	readonly relaunchError?: UpdaterError;
}

export interface RelaunchResult {
	readonly ok: true;
	readonly started: boolean;
}

/** The halves the plugin cannot own: the network, the bundle on disk and starting one. */
export interface UpdaterAdapter {
	/** GET `url` and parse it as JSON; a non-2xx answer throws `check-failed`. */
	fetchJson(url: string): Promise<unknown>;
	/** GET `url` and write the bytes into `directory`, answering the file it made. */
	download(url: string, directory: string): Promise<{ path: string; bytes: number }>;
	/** Lowercase hex digest of a file on disk. */
	sha256(path: string): Promise<string>;
	/** The artifact's bytes, for an Ed25519 check that signs bytes and not a digest. */
	readBytes(path: string): Promise<Uint8Array>;
	/** A fresh directory the plugin may write into; the OS owns its lifetime. */
	makeTempDir(): Promise<string>;
	/** True only for an existing directory whose name ends in `.app`. */
	isAppBundle(path: string): Promise<boolean>;
	/** Move `source` onto `target`, parking whatever is at `target` at `backup`. */
	replaceBundle(source: string, target: string, backup: string): Promise<void>;
	/** Start `appPath` as a new instance; a throw means it never started. */
	relaunch?(appPath: string): Promise<void>;
}
