/**
 * Content stamp for the compiled framework cache. The marker is a hash of file names and bytes,
 * not a done flag, so a tree planted behind a marker cannot pass verification on a later launch.
 */
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

export const FRAMEWORK_MARKER = ".complete";

/** One file the generated entry will import from the compiled cache. */
export interface FrameworkEntry {
	relative: string;
	bytes(): Promise<Uint8Array>;
}

/** Stable regardless of the order `listAssets` or a directory walk returns files. */
export async function frameworkStamp(entries: readonly FrameworkEntry[]): Promise<string> {
	const hash = createHash("sha256");
	for (const entry of [...entries].sort((left, right) =>
		left.relative.localeCompare(right.relative),
	)) {
		hash.update(entry.relative)
			.update("\0")
			.update(await entry.bytes())
			.update("\0");
	}
	return hash.digest("hex");
}

/**
 * Recompute the stamp from a published tree. The compiled-binary e2e uses this to prove the marker
 * describes the bytes it guards rather than merely announcing that a write finished.
 */
export async function frameworkTreeStamp(tree: string): Promise<string> {
	const entries: FrameworkEntry[] = [];
	async function walk(dir: string, prefix: string): Promise<void> {
		const files = await readdir(dir, { withFileTypes: true });
		for (const entry of files.sort((left, right) => left.name.localeCompare(right.name))) {
			if (entry.name === FRAMEWORK_MARKER) continue;
			const relative = `${prefix}${entry.name}`;
			const path = join(dir, entry.name);
			if (entry.isDirectory()) await walk(path, `${relative}/`);
			else if (entry.isFile()) entries.push({ relative, bytes: () => readFile(path) });
		}
	}
	await walk(tree, "");
	return frameworkStamp(entries);
}
