/**
 * `crust:updater`'s command shapes: what each command takes, what it answers, and the {@link UpdaterAdapter} seam that the network, the bundle on disk and the launch sit behind.
 * Nothing here runs anything, so a test can type a fake without touching a filesystem.
 */

import type { UpdaterError, UpdaterFailure } from "./updater-args";

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
	/** Absolute `https` URL; `file` only when the config sets `updater.allowFileUrl`. */
	url: string;
	/** Required, hex either case: no digest, no download. */
	sha256: string;
	/** Base64 Ed25519 over the artifact bytes; needs `updater.pubkey` in the config. */
	signature?: string;
	/** Base64 of 32 raw bytes; it may only name the configured key, never replace it. */
	pubkey?: string;
}

/** What a `crust.config.ts` `updater` section becomes: the defaults a page does not have to pass. */
export interface UpdaterOptions {
	/** Manifest URL `check` falls back to when the page passes none. */
	endpoint?: string;
	/** The only key this app accepts; a signature is verified with this key and no other. */
	pubkey?: string;
	/** Whether the app wants a check at startup; reported by `updater.config`. */
	autoCheck?: boolean;
	/** Whether `download` may fetch a `file:` URL. Off unless the app says so. */
	allowFileUrl?: boolean;
}

export interface InstallArgs extends BundleArgs {
	/**
	 * The artifact `updater.download` verified in this run. Any other path is refused with
	 * `unverified-artifact`, because a page must not choose what gets renamed into place.
	 */
	path: string;
	/** Start the replaced bundle once the swap lands; a launch failure is reported, not rolled back. */
	relaunch?: boolean;
}

export interface DownloadResult {
	readonly ok: true;
	/** What `install` takes: the downloaded file, or the `.app` this run extracted from a zip. */
	readonly path: string;
	readonly bytes: number;
	/**
	 * The digest that was verified, lowercase hex. For an archive this is the extracted tree's
	 * digest, which is the artifact `install` renames; the archive's own digest is in `archive`.
	 */
	readonly sha256: string;
	/** The configured key that verified the signature, when the manifest carried one. */
	readonly signer?: string;
	/** Set when the artifact was a zip: the archive it came from, and the digest verified over it. */
	readonly archive?: { readonly path: string; readonly sha256: string };
}

/** `ok: false` from `install`, with the bundle paths a page needs to make sense of the failure. */
export interface InstallFailure extends UpdaterFailure {
	readonly appPath: string;
	readonly backup: string;
	/** The swap landed and only the launch failed; the new build is installed. */
	readonly installed?: true;
	/** The swap landed but the old bundle could not be restored; this is its only copy. */
	readonly parkedAt?: string;
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
	/** Remove one of those directories once no receipt needs it. */
	removeTempDir?(path: string): Promise<void>;
	/**
	 * Extract a zip into a directory this adapter owns, answering the one `.app` it held, or
	 * `undefined` when the artifact is not a zip and is installed as a file. A hostile entry — an
	 * absolute path, a `..` segment, a symlink pointing outside — throws `invalid-archive`.
	 */
	extractZip(archive: string): Promise<{ path: string; entries: number } | undefined>;
	/** True only for an existing directory whose name ends in `.app`. */
	isAppBundle(path: string): Promise<boolean>;
	/** Move `source` onto `target`, parking whatever is at `target` at `backup`. */
	replaceBundle(source: string, target: string, backup: string): Promise<void>;
	/** Start `appPath` as a new instance; a throw means it never started. */
	relaunch?(appPath: string): Promise<void>;
}
