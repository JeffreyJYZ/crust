/**
 * `updater.download`'s body: fetch, verify, and hand `install` something it can name. A digest is
 * mandatory and a signature is verified with the config's pinned key alone, so nothing reaches the
 * receipt that this run did not check; what the bytes turn out to be — a file, a bundle, or a zip
 * extracted into a directory — is {@link materialiseArtifact}'s call.
 */

import { materialiseArtifact } from "./updater-artifact";
import {
	errorOf,
	hashMismatch,
	invalidArguments,
	readSha256,
	readString,
	type UpdaterFailure,
} from "./updater-args";
import type { Receipts } from "./updater-receipt";
import {
	readSignatureArgs,
	requiresPubkey,
	signatureMismatch,
	verifyEd25519,
} from "./updater-signature";
import type { DownloadArgs, DownloadResult, UpdaterAdapter, UpdaterOptions } from "./updater-types";
import { fetchUrlFailure } from "./updater-url";

export async function runDownload(
	adapter: UpdaterAdapter,
	options: UpdaterOptions,
	receipts: Receipts,
	args: DownloadArgs,
): Promise<DownloadResult | UpdaterFailure> {
	const url = readString(args, "url");
	if (url === undefined) return invalidArguments("download", "needs { url }", args);
	const refused = fetchUrlFailure(url, { allowFile: options.allowFileUrl === true });
	if (refused !== undefined) return refused;
	const expected = readSha256(args);
	if (expected === undefined || expected === null) {
		const detail = "requires sha256, because an artifact nothing verified is no artifact";
		return { ...invalidArguments("download", detail, args), requires: "sha256" };
	}
	const signature = readString(args, "signature");
	if (signature !== undefined && options.pubkey === undefined) return requiresPubkey(args);
	const signed = readSignatureArgs(args, options.pubkey);
	if (signed === null) {
		return invalidArguments("download", "refuses a pubkey that is not this app's", args);
	}
	try {
		const file = await adapter.download(url, await adapter.makeTempDir());
		const actual = (await adapter.sha256(file.path)).toLowerCase();
		if (actual !== expected) return hashMismatch(file.path, actual, expected);
		let signer: string | undefined;
		if (signed !== undefined) {
			// The signature is over the artifact's own bytes: for a zip, the archive the author
			// shipped, which is the only thing that has bytes to sign.
			const bytes = await adapter.readBytes(file.path);
			const verified = await verifyEd25519(signed.pubkey, signed.signature, bytes);
			if (!verified) return signatureMismatch(file.path);
			signer = signed.pubkey;
		}
		const artifact = await materialiseArtifact(adapter, file, actual);
		receipts.record({
			path: artifact.path,
			sha256: artifact.sha256,
			signer,
			archive: artifact.archive,
		});
		return {
			ok: true,
			path: artifact.path,
			bytes: artifact.bytes,
			sha256: artifact.sha256,
			signer,
			archive: artifact.archive,
		};
	} catch (error) {
		return { ok: false, ...errorOf(error, "download-failed") };
	}
}
