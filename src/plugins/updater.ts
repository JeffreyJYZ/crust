/**
 * `crust:updater` — check, download, install, relaunch: Tauri's updater minus the installer binary. The three halves it cannot own, the network, the bundle on disk and the launch, sit behind an {@link UpdaterAdapter}, so the default runs on `fetch`, `node:fs` and `open`, and a test swaps in a fake. `install` renames the new bundle over the old, parks the old at `<appPath>.old`, and never runs `codesign`: a replaced process cannot survive its own swap, and the signature belongs to whoever shipped the artifact.
 * Nothing is installed that this run did not verify: `download` requires a sha256, fetches `https` only, verifies a signature with the config's pinned key alone, and records a receipt that `install` refuses to work without.
 * A signature is over file bytes, so a `.app` bundle has nothing to sign: an author ships a **zip**, `download` verifies the archive, extracts it, and records both the archive's digest and the extracted tree's, so `install` re-checks the half that was signed and the half that gets renamed.
 */

import { definePlugin } from "./define";
import {
	badCheck,
	type CheckResult,
	checkFailure,
	errorOf,
	invalidArguments,
	isNewer,
	notAppBundle,
	platformFailure,
	readString,
	type UpdaterFailure,
} from "./updater-args";
import { parseManifest } from "./updater-manifest";
import { nodeUpdaterAdapter } from "./updater-node";
import { fetchUrlFailure } from "./updater-url";
import { createLauncher, ownBundleFailure } from "./updater-bundle";
import { runDownload } from "./updater-download";
import {
	archiveChangedSinceDownload,
	changedSinceDownload,
	createReceipts,
	unverifiedArtifact,
} from "./updater-receipt";
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

export * from "./updater-archive";
export * from "./updater-args";
export * from "./updater-manifest";
export * from "./updater-node";
export * from "./updater-signature";
export * from "./updater-types";

export function createUpdaterPlugin(
	adapter: UpdaterAdapter = nodeUpdaterAdapter(),
	options: UpdaterOptions = {},
	/** Where this process's executable sits: `relaunch` derives its own bundle from it. */
	execPath: string = process.execPath,
	/**
	 * The OS this app actually runs on. `install` and `relaunch` replace a `.app` and run `open -n`,
	 * so they refuse by name off macOS; separate from `execPath` so a test can prove both arms.
	 */
	platform: string = process.platform,
) {
	/** Every artifact this instance verified, so `install` can refuse anything else. */
	const receipts = createReceipts();
	/** `undefined` once the bundle starts; a refusal, a missing launcher or a throw is the answer. */
	const start = createLauncher(adapter, execPath);

	return definePlugin({
		name: "updater",
		commands: {
			config: async () => ({
				endpoint: options.endpoint,
				pubkey: options.pubkey,
				autoCheck: options.autoCheck === true,
				allowFileUrl: options.allowFileUrl === true,
			}),
			check: async (args: CheckArgs): Promise<CheckResult> => {
				const endpoint = readString(args, "endpoint") ?? options.endpoint;
				const currentVersion = readString(args, "currentVersion");
				if (endpoint === undefined || currentVersion === undefined) {
					return badCheck("check", "needs { endpoint, currentVersion }", args);
				}
				// check fetches a page-supplied endpoint too, so it obeys the same scheme policy as
				// download: https only, and file only when the app opted in with updater.allowFileUrl.
				const refused = fetchUrlFailure(
					endpoint,
					{ allowFile: options.allowFileUrl === true },
					"check",
				);
				if (refused !== undefined) return checkFailure(refused.code, refused.message);
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
			download: (args: DownloadArgs): Promise<DownloadResult | UpdaterFailure> =>
				runDownload(adapter, options, receipts, args),
			install: async (args: InstallArgs): Promise<InstallResult | UpdaterFailure> => {
				if (platform !== "darwin") return platformFailure("install", platform);
				const source = readString(args, "path");
				const appPath = readString(args, "appPath");
				if (source === undefined || appPath === undefined) {
					return invalidArguments("install", "needs { path, appPath }", args);
				}
				const receipt = receipts.get(source);
				if (receipt === undefined) return unverifiedArtifact(source);
				try {
					if (!(await adapter.isAppBundle(appPath))) {
						return notAppBundle(appPath, "is not an existing .app directory");
					}
					// The receipt proves the bytes; this proves the destination, so an update can
					// only replace the bundle this process is running from.
					const elsewhere = await ownBundleFailure(appPath, execPath, "install");
					if (elsewhere !== undefined) return elsewhere;
					if (!(await adapter.isAppBundle(source))) {
						return notAppBundle(source, "is not an .app directory; extract it first");
					}
					// An extracted archive's receipt covers two digests: the zip that was signed and
					// the tree that gets renamed. The tree is the one compared here, because a
					// directory's digest can never equal the archive's, and both are re-checked so
					// neither half can change behind the other.
					if (receipt.archive !== undefined) {
						const archived = (await adapter.sha256(receipt.archive.path)).toLowerCase();
						if (archived !== receipt.archive.sha256) {
							return archiveChangedSinceDownload(
								receipt.archive.path,
								archived,
								receipt.archive.sha256,
							);
						}
					}
					const actual = (await adapter.sha256(source)).toLowerCase();
					if (actual !== receipt.sha256) {
						return changedSinceDownload(source, actual, receipt.sha256);
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
				if (platform !== "darwin") return platformFailure("relaunch", platform);
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
