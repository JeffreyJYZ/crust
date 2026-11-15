/**
 * `crust:updater` — check, download, install, relaunch: Tauri's updater minus the installer binary. The three halves it cannot own, the network, the bundle on disk and the launch, sit behind an {@link UpdaterAdapter}, so the default runs on `fetch`, `node:fs` and `open`, and a test swaps in a fake. `install` renames the new bundle over the old, parks the old at `<appPath>.old`, and never runs `codesign`: a replaced process cannot survive its own swap, and the signature belongs to whoever shipped the artifact.
 * A manifest may also carry `signature` and `pubkey`, and then `download` refuses an artifact whose bytes do not verify: sha256 catches a corrupt transfer, Ed25519 catches a swapped manifest.
 */

import { definePlugin } from "./define";
import {
	badCheck,
	type CheckResult,
	checkFailure,
	errorOf,
	hashMismatch,
	invalidArguments,
	isNewer,
	notAppBundle,
	readSha256,
	readString,
	type UpdaterError,
	type UpdaterFailure,
} from "./updater-args";
import { parseManifest } from "./updater-manifest";
import { nodeUpdaterAdapter } from "./updater-node";
import { readSignatureArgs, signatureMismatch, verifyEd25519 } from "./updater-signature";
import type {
	BundleArgs,
	CheckArgs,
	DownloadArgs,
	DownloadResult,
	InstallArgs,
	InstallResult,
	RelaunchResult,
	UpdaterAdapter,
	UpdaterOptions,
} from "./updater-types";

export * from "./updater-args";
export * from "./updater-manifest";
export * from "./updater-node";
export * from "./updater-signature";
export * from "./updater-types";

export function createUpdaterPlugin(
	adapter: UpdaterAdapter = nodeUpdaterAdapter(),
	options: UpdaterOptions = {},
) {
	/** `undefined` once the bundle starts; a missing launcher or a throw is the failure returned. */
	const start = async (appPath: string): Promise<UpdaterError | undefined> => {
		if (adapter.relaunch === undefined) {
			return { code: "relaunch-failed", message: "crust: updater.relaunch: no launcher" };
		}
		try {
			await adapter.relaunch(appPath);
			return undefined;
		} catch (error) {
			return errorOf(error, "relaunch-failed");
		}
	};

	return definePlugin({
		name: "updater",
		commands: {
			config: async () => ({
				endpoint: options.endpoint,
				pubkey: options.pubkey,
				autoCheck: options.autoCheck === true,
			}),
			check: async (args: CheckArgs): Promise<CheckResult> => {
				const endpoint = readString(args, "endpoint") ?? options.endpoint;
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
				const { version, url, notes, sha256, signature, pubkey } = parsed.manifest;
				const pinned = options.pubkey;
				if (pubkey !== undefined && pinned !== undefined && pubkey !== pinned) {
					return checkFailure(
						"bad-manifest",
						"crust: updater.check: the manifest's pubkey is not this app's",
					);
				}
				if (!isNewer(version, currentVersion)) return { available: false, version };
				return { available: true, version, url, notes, sha256, signature, pubkey };
			},
			download: async (args: DownloadArgs): Promise<DownloadResult | UpdaterFailure> => {
				const url = readString(args, "url");
				if (url === undefined) return invalidArguments("download", "needs { url }", args);
				const expected = readSha256(args);
				if (expected === null) return invalidArguments("download", "bad sha256", args);
				const signed = readSignatureArgs(args, options.pubkey);
				if (signed === null) {
					return invalidArguments(
						"download",
						"a signature needs this app's pubkey",
						args,
					);
				}
				try {
					const file = await adapter.download(url, await adapter.makeTempDir());
					const found = { ok: true as const, path: file.path, bytes: file.bytes };
					if (expected !== undefined) {
						const actual = (await adapter.sha256(file.path)).toLowerCase();
						if (actual !== expected) return hashMismatch(file.path, actual, expected);
					}
					if (signed !== undefined) {
						const bytes = await adapter.readBytes(file.path);
						const verified = await verifyEd25519(
							signed.pubkey,
							signed.signature,
							bytes,
						);
						if (!verified) return signatureMismatch(file.path);
					}
					return expected === undefined ? found : { ...found, sha256: expected };
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
					if (args.relaunch !== true) return { ok: true, appPath, backup };
					// The swap already landed, so a failed launch is reported beside it, not undone.
					const relaunchError = await start(appPath);
					if (relaunchError === undefined) return { ok: true, appPath, backup };
					return { ok: true, appPath, backup, relaunchError };
				} catch (error) {
					return { ok: false, ...errorOf(error, "install-failed") };
				}
			},
			relaunch: async (args: BundleArgs): Promise<RelaunchResult | UpdaterFailure> => {
				const appPath = readString(args, "appPath");
				if (appPath === undefined) {
					return invalidArguments("relaunch", "needs { appPath }", args);
				}
				if (!(await adapter.isAppBundle(appPath))) {
					return notAppBundle(appPath, "is not an existing .app directory", "relaunch");
				}
				const failure = await start(appPath);
				if (failure !== undefined) return { ok: false, ...failure, path: appPath };
				return { ok: true, started: true };
			},
		},
	});
}

/** The default registration: the node adapter, so `updater` needs no platform instance. */
export const updaterPlugin = createUpdaterPlugin();
