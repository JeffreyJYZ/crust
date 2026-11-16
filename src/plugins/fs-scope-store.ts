/**
 * `scope.json`, the one file a grant persists to: a check reads this list and never scans a directory.
 * A missing, unreadable or corrupt file is an empty grant list, never a startup failure, and the write is
 * `0600` through a temporary file plus a rename so a crash mid-write leaves the previous grants intact.
 */

import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute } from "node:path";

/** One file for every grant, so a check never scans a directory. */
export const SCOPE_FILE = "scope.json";

export async function readStore(file: string): Promise<string[]> {
	const text = await readFile(file, "utf8").catch(() => undefined);
	if (text === undefined) return [];
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		return [];
	}
	if (!Array.isArray(parsed)) return [];
	return parsed.filter((path): path is string => typeof path === "string" && isAbsolute(path));
}

/** A temporary file in the same directory, then a rename; `0600` because the list names private directories. */
export async function writeStore(file: string, paths: string[]): Promise<void> {
	await mkdir(dirname(file), { recursive: true });
	const temporary = `${file}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
	try {
		await writeFile(temporary, `${JSON.stringify(paths, null, "\t")}\n`, {
			mode: 0o600,
		});
		await rename(temporary, file);
	} catch (error) {
		await rm(temporary, { force: true });
		throw error;
	}
}
