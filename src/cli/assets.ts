import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { crustRoot } from "./util.ts";

/**
 * A file crust ships with itself: a template, a doc, the C shim. In a checkout it is a real file under the package root; in a `bun build --compile` output the same paths are embedded with `--asset` and `crustRoot` collapses to `/`, so a disk read must fall back to what the executable carries.
 */
export type CrustAsset = {
	/** Path relative to the crust root, always with forward slashes. */
	relative: string;
	/** The bytes, from disk when they exist there and from the executable otherwise. */
	bytes: () => Promise<Uint8Array>;
};

/** The embedded name of a blob, normalized to forward slashes, or undefined when it has none. */
function nameOf(blob: Blob): string | undefined {
	const name = (blob as { name?: unknown }).name;
	return typeof name === "string" && name.length > 0 ? name.replaceAll("\\", "/") : undefined;
}

/**
 * Embedded files under a crust-root-relative directory. `--asset` preserves the path relative to the build root, so `--asset=templates` yields `templates/react/main.ts` and a directory must be matched by prefix rather than by basename.
 */
function embeddedUnder(dir: string): CrustAsset[] {
	const blobs = Bun.embeddedFiles ?? [];
	const prefix = `${dir.replaceAll("\\", "/").replace(/\/+$/, "")}/`;
	const assets: CrustAsset[] = [];
	for (const blob of blobs) {
		const name = nameOf(blob);
		if (name === undefined || !name.startsWith(prefix)) continue;
		assets.push({
			relative: name.slice(prefix.length),
			bytes: async () => new Uint8Array(await blob.arrayBuffer()),
		});
	}
	return assets.sort((left, right) => left.relative.localeCompare(right.relative));
}

/** Files under a real directory, as paths relative to it, sorted for a stable output. */
async function filesUnder(root: string, dir = root): Promise<string[]> {
	const entries = await readdir(dir, { withFileTypes: true });
	const files: string[] = [];
	for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) files.push(...(await filesUnder(root, path)));
		else if (entry.isFile()) files.push(path.slice(root.length + 1).replaceAll("\\", "/"));
	}
	return files;
}

/**
 * Every file under a crust-root-relative directory: disk first, embedded second.
 *
 * Disk wins so a checkout behaves exactly as it did before embedding existed, and so
 * a compiled binary made without `--asset` still works when it sits beside real files.
 */
export async function listAssets(dir: string): Promise<CrustAsset[]> {
	const disk = resolve(crustRoot, dir);
	try {
		const files = await filesUnder(disk);
		return files.map((relative) => ({
			relative,
			bytes: async () => new Uint8Array(await readFile(join(disk, relative))),
		}));
	} catch (error) {
		const embedded = embeddedUnder(dir);
		if (embedded.length > 0) return embedded;
		throw error;
	}
}

/** One file, disk first and embedded second, or undefined when neither has it. */
export async function readAsset(relative: string): Promise<Uint8Array | undefined> {
	try {
		return new Uint8Array(await readFile(resolve(crustRoot, relative)));
	} catch {
		const name = relative.replaceAll("\\", "/");
		const blobs = Bun.embeddedFiles ?? [];
		const exact = blobs.find((candidate) => nameOf(candidate) === name);
		if (exact) return new Uint8Array(await exact.arrayBuffer());
		// Embedding does not always keep the whole path. `--asset=src/platform/darwin`
		// yields `darwin/shim/10_prelude.c` — the asset's own top-level name and below — and
		// `--asset=<file>` yields just the basename. So a lookup falls back to the
		// basename, and only when exactly one embedded file carries it: two `main.ts`
		// in the tree must not resolve to each other.
		const base = baseName(name);
		const byBase = blobs.filter((candidate) => {
			const candidateName = nameOf(candidate);
			return candidateName !== undefined && baseName(candidateName) === base;
		});
		return byBase.length === 1 ? new Uint8Array(await byBase[0]!.arrayBuffer()) : undefined;
	}
}

/** The last path segment, with separators normalized. */
function baseName(path: string): string {
	const normalized = path.replaceAll("\\", "/");
	return normalized.slice(normalized.lastIndexOf("/") + 1);
}

/** True when the path is available from the executable rather than from disk. */
export function isEmbedded(relative: string): boolean {
	const name = relative.replaceAll("\\", "/");
	const blobs = Bun.embeddedFiles ?? [];
	if (blobs.some((blob) => nameOf(blob) === name)) return true;
	const base = baseName(name);
	return (
		blobs.filter((blob) => {
			const candidateName = nameOf(blob);
			return candidateName !== undefined && baseName(candidateName) === base;
		}).length === 1
	);
}
