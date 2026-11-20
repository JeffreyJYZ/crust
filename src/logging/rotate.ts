/**
 * Generation rotation. `app.jsonl` is the live file; past `maxBytes` it becomes `app.1.jsonl`, the
 * old `app.1.jsonl` becomes `app.2.jsonl`, and the oldest generation is deleted — the last one to
 * go, so a burst cannot lose the oldest surviving line before a newer one. `errors.jsonl` uses the
 * same rule with one archive.
 *
 * The archive name keeps the extension (`app.jsonl` -> `app.1.jsonl`) because that is the name the
 * brief, the docs and a person's `ls` all expect.
 */

import { rename, rm } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";

/** `app.jsonl` + 2 -> `<dir>/app.2.jsonl`. */
export function archivePath(file: string, generation: number): string {
	const extension = extname(file);
	return join(dirname(file), `${basename(file, extension)}.${generation}${extension}`);
}

function missing(error: unknown): boolean {
	return (error as NodeJS.ErrnoException)?.code === "ENOENT";
}

/**
 * Shift the chain once and move `file` into generation 1. A missing generation is skipped, not an
 * error: a first rotation has nothing to shift. Returns the archive the live file moved to.
 */
export async function rotateChain(file: string, generations: number): Promise<string | undefined> {
	const target = archivePath(file, Math.max(1, generations));
	if (generations <= 1) {
		// One generation still means "the live file moves aside"; the previous archive is replaced.
		await rm(target, { force: true });
	} else {
		await rm(archivePath(file, generations), { force: true });
		for (let index = generations - 1; index >= 1; index--) {
			try {
				await rename(archivePath(file, index), archivePath(file, index + 1));
			} catch (error) {
				if (!missing(error)) throw error;
			}
		}
	}
	try {
		await rename(file, archivePath(file, 1));
	} catch (error) {
		if (!missing(error)) throw error;
		return undefined;
	}
	return archivePath(file, 1);
}
