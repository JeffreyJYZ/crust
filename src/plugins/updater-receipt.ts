/**
 * `crust:updater`'s verification receipts: `download` records the artifact it verified, and
 * `install` refuses any path without one, so a page cannot hand the plugin a bundle it dropped on
 * disk and have it renamed over the running app.
 * The registry is per plugin instance and in memory only: a receipt cannot be forged, persisted or
 * replayed from an earlier run, and it dies with the process that made it.
 */

import { resolve } from "node:path";

import type { UpdaterFailure } from "./updater-args";

/** What `download` verified, in the run that verified it. */
export interface DownloadReceipt {
	/** The artifact `download` wrote: the only path `install` accepts. */
	readonly path: string;
	/** Lowercase hex digest of that artifact, recomputed by `install` before the swap. */
	readonly sha256: string;
	/** The configured key that verified the signature; absent when no signature was claimed. */
	readonly signer?: string;
}

export interface Receipts {
	record(receipt: DownloadReceipt): void;
	/** The receipt `download` recorded for exactly this path, if this run recorded one. */
	get(path: string): DownloadReceipt | undefined;
}

export function createReceipts(): Receipts {
	const byPath = new Map<string, DownloadReceipt>();
	return {
		record: (receipt) => {
			byPath.set(resolve(receipt.path), receipt);
		},
		get: (path) => byPath.get(resolve(path)),
	};
}

/** Nothing is installed from a path this run never verified, and the refusal says why. */
export function unverifiedArtifact(path: string): UpdaterFailure {
	const message =
		`crust: updater.install refuses ${path}: no updater.download verified it in this run, ` +
		"so nothing proves these bytes are the update the app fetched";
	return { ok: false, code: "unverified-artifact", message, path };
}

/** A verified artifact that changed afterwards is refused, not installed. */
export function changedSinceDownload(
	path: string,
	actual: string,
	expected: string,
): UpdaterFailure {
	const message = `crust: updater.install: ${path} changed since download — sha256 ${actual}, verified ${expected}`;
	return { ok: false, code: "hash-mismatch", message, path };
}
