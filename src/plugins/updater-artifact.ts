/**
 * What a downloaded artifact turns out to be. A signature is over file bytes, so an `.app` bundle
 * has nothing to hand a verifier; shipping a zip gives `download` bytes to verify and `install` a
 * directory to rename, and an app that ships a zip and extracts it itself still gets its file.
 * The rule is the bytes, never the file name: only an artifact that really opens like a zip is
 * extracted, so a `.zip`-named file of anything else keeps the file path it always had.
 */

import type { UpdaterAdapter } from "./updater-types";

/** The verified artifact `install` will accept, whether it came out of an archive or not. */
export interface Artifact {
	/** The file, or the `.app` directory an archive was extracted into. */
	readonly path: string;
	/** The artifact's size on disk as downloaded; for an archive, the archive's size. */
	readonly bytes: number;
	/** Lowercase hex: the tree digest for a directory, the byte digest for a file. */
	readonly sha256: string;
	/** Set only when the artifact was a zip, naming the archive and the digest verified over it. */
	readonly archive?: { readonly path: string; readonly sha256: string };
}

/**
 * `sha256` is the digest already verified over the downloaded bytes. A directory artifact is
 * returned as it is, which is the path an app has always had; a zip is extracted and answered as
 * the tree `install` will rename, with the archive recorded beside it.
 */
export async function materialiseArtifact(
	adapter: UpdaterAdapter,
	file: { path: string; bytes: number },
	sha256: string,
): Promise<Artifact> {
	if (await adapter.isAppBundle(file.path)) {
		return { path: file.path, bytes: file.bytes, sha256 };
	}
	const extracted = await adapter.extractZip(file.path);
	if (extracted === undefined) return { path: file.path, bytes: file.bytes, sha256 };
	const tree = (await adapter.sha256(extracted.path)).toLowerCase();
	return {
		path: extracted.path,
		bytes: file.bytes,
		sha256: tree,
		archive: { path: file.path, sha256 },
	};
}
