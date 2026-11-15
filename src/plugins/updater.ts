/**
 * `crust:updater` — check, download, install: Tauri's updater minus the installer binary. The two halves it cannot own, the network and the bundle on disk, sit behind an {@link UpdaterAdapter}, so the default runs on `fetch` and a test swaps in a fake. `install` renames the new bundle over the old, parks the old at `<appPath>.old`, and never relaunches or runs `codesign`: a replaced process cannot survive its own swap, and the signature belongs to whoever shipped the artifact.
 */

import { createHash } from "node:crypto";
import { mkdtemp, readFile, rename, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { definePlugin } from "./define";
import {
	badCheck,
	type CheckResult,
	checkFailure,
	errorOf,
	fileNameFor,
	hashMismatch,
	invalidArguments,
	isNewer,
	notAppBundle,
	parseManifest,
	readSha256,
	readString,
	UpdaterAdapterError,
	type UpdaterFailure,
} from "./updater-args";

export * from "./updater-args";

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
}

export interface InstallArgs {
	/** The downloaded artifact: it must already be an `.app` directory. */
	path: string;
	/** The bundle to replace, e.g. `/Applications/Notes.app`. */
	appPath: string;
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
}

/** The two halves the plugin cannot own: the network and the bundle on disk. */
export interface UpdaterAdapter {
	/** GET `url` and parse it as JSON; a non-2xx answer throws `check-failed`. */
	fetchJson(url: string): Promise<unknown>;
	/** GET `url` and write the bytes into `directory`, answering the file it made. */
	download(url: string, directory: string): Promise<{ path: string; bytes: number }>;
	/** Lowercase hex digest of a file on disk. */
	sha256(path: string): Promise<string>;
	/** A fresh directory the plugin may write into; the OS owns its lifetime. */
	makeTempDir(): Promise<string>;
	/** True only for an existing directory whose name ends in `.app`. */
	isAppBundle(path: string): Promise<boolean>;
	/** Move `source` onto `target`, parking whatever is at `target` at `backup`. */
	replaceBundle(source: string, target: string, backup: string): Promise<void>;
}

/** The default adapter: `fetch` plus `node:fs`, which every platform crust runs on already has. */
export function nodeUpdaterAdapter(): UpdaterAdapter {
	return {
		async fetchJson(url) {
			const response = await fetch(url, { headers: { accept: "application/json" } });
			if (!response.ok) {
				throw new UpdaterAdapterError("check-failed", `updater: ${url} ${response.status}`);
			}
			return await response.json();
		},
		async download(url, directory) {
			const response = await fetch(url);
			if (!response.ok) {
				throw new UpdaterAdapterError(
					"download-failed",
					`updater: ${url} ${response.status}`,
				);
			}
			const path = join(directory, fileNameFor(url));
			await Bun.write(path, response);
			return { path, bytes: (await stat(path)).size };
		},
		async sha256(path) {
			return createHash("sha256")
				.update(await readFile(path))
				.digest("hex");
		},
		async makeTempDir() {
			return await mkdtemp(join(tmpdir(), "crust-update-"));
		},
		async isAppBundle(path) {
			if (!path.endsWith(".app")) return false;
			const info = await stat(path).catch(() => undefined);
			return info?.isDirectory() === true;
		},
		// One rename on one volume is atomic, and the temp dir shares the boot volume with
		// `/Applications`. A cross-volume EXDEV is a real install error, not a case to paper
		// over with a copy that is no longer atomic.
		async replaceBundle(source, target, backup) {
			await rm(backup, { recursive: true, force: true });
			await rename(target, backup);
			try {
				await rename(source, target);
			} catch (error) {
				await rename(backup, target).catch(() => undefined);
				throw error;
			}
		},
	};
}

export function createUpdaterPlugin(adapter: UpdaterAdapter = nodeUpdaterAdapter()) {
	return definePlugin({
		name: "updater",
		commands: {
			check: async (args: CheckArgs): Promise<CheckResult> => {
				const endpoint = readString(args, "endpoint");
				const currentVersion = readString(args, "currentVersion");
				if (endpoint === undefined || currentVersion === undefined) {
					return badCheck("check", "needs { endpoint, currentVersion }", args);
				}
				let payload: unknown;
				try {
					payload = await adapter.fetchJson(endpoint);
				} catch (error) {
					const { code, message } = errorOf(error, "check-failed");
					return checkFailure(code, message);
				}
				const parsed = parseManifest(payload);
				if (!parsed.ok) {
					return checkFailure("bad-manifest", `crust: updater.check: ${parsed.reason}`);
				}
				const { version, url, notes, sha256 } = parsed.manifest;
				if (!isNewer(version, currentVersion)) return { available: false, version };
				return { available: true, version, url, notes, sha256 };
			},
			download: async (args: DownloadArgs): Promise<DownloadResult | UpdaterFailure> => {
				const url = readString(args, "url");
				if (url === undefined) return invalidArguments("download", "needs { url }", args);
				const expected = readSha256(args);
				if (expected === null) return invalidArguments("download", "bad sha256", args);
				try {
					const file = await adapter.download(url, await adapter.makeTempDir());
					const found = { ok: true as const, path: file.path, bytes: file.bytes };
					if (expected === undefined) return found;
					const actual = (await adapter.sha256(file.path)).toLowerCase();
					if (actual !== expected) return hashMismatch(file.path, actual, expected);
					return { ...found, sha256: actual };
				} catch (error) {
					return { ok: false, ...errorOf(error, "download-failed") };
				}
			},
			install: async (args: InstallArgs): Promise<InstallResult | UpdaterFailure> => {
				const source = readString(args, "path");
				const appPath = readString(args, "appPath");
				if (source === undefined || appPath === undefined) {
					return invalidArguments("install", "needs { path, appPath }", args);
				}
				try {
					if (!(await adapter.isAppBundle(appPath))) {
						return notAppBundle(appPath, "is not an existing .app directory");
					}
					if (!(await adapter.isAppBundle(source))) {
						return notAppBundle(source, "is not an .app directory; extract it first");
					}
					const backup = `${appPath}.old`;
					await adapter.replaceBundle(source, appPath, backup);
					return { ok: true, appPath, backup };
				} catch (error) {
					return { ok: false, ...errorOf(error, "install-failed") };
				}
			},
		},
	});
}

/** The default registration: the node adapter, so `updater` needs no platform instance. */
export const updaterPlugin = createUpdaterPlugin();
