/**
 * `crust:fs` — text files, directories and their metadata. Every failure carries a structured code (`not-found`, `bad-request`), and nothing here is synchronous because one blocking handler stalls every other invoke on the bridge (`research/bridge.md` §Concurrency).
 * `list`, `stat`, `remove` and `rename` exist because a real app asked: notes on disk need a listing and a delete, and without them every app reimplements path handling.
 */

import { rename as renamePath, rm, readdir, stat as statPath } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";

import { CrustError } from "../bridge/errors";
import { definePlugin } from "./define";

export interface ReadTextFileArgs {
	/** Absolute or cwd-relative path. */
	path: string;
}

export interface WriteTextFileArgs {
	path: string;
	contents: string;
}

export interface WriteTextFileResult {
	/** Bytes actually written, as `Bun.write` reports them. */
	bytes: number;
}

export interface ListArgs {
	path: string;
}

export interface ListEntry {
	/** Basename, never a path. */
	name: string;
	/** Absolute path, so a page never has to join strings. */
	path: string;
	directory: boolean;
	/** Bytes for a file; 0 for a directory. */
	size: number;
}

export interface ListResult {
	entries: ListEntry[];
}

export interface StatArgs {
	path: string;
}

export interface StatResult {
	path: string;
	directory: boolean;
	size: number;
	/** Milliseconds since the epoch, as `fs.stat` reports it. */
	modified: number;
}

export interface RemoveArgs {
	path: string;
	/** Remove a directory and everything under it. Refused for a non-empty one otherwise. */
	recursive?: boolean;
}

export interface RemoveResult {
	removed: boolean;
	path: string;
}

export interface RenameArgs {
	from: string;
	to: string;
}

export interface RenameResult {
	path: string;
}

function requirePath(value: unknown): string {
	if (typeof value !== "string" || value.length === 0) {
		throw new CrustError("bad-request", 'fs: "path" must be a non-empty string');
	}
	return value;
}

/** Absolute form, so a returned path is usable from a page whose cwd is `/`. */
function absolute(path: string): string {
	return isAbsolute(path) ? path : resolve(path);
}

/** A missing path is `not-found`, which is the one filesystem error worth naming. */
function missing(error: unknown, path: string, command: string): never {
	const code = (error as { code?: string } | undefined)?.code;
	if (code === "ENOENT") throw new CrustError("not-found", `fs.${command}: no path at ${path}`);
	throw error;
}

export const fsPlugin = definePlugin({
	name: "fs",
	commands: {
		readTextFile: async ({ path }: ReadTextFileArgs): Promise<string> => {
			const file = requirePath(path);
			const handle = Bun.file(file);
			if (!(await handle.exists())) {
				throw new CrustError("not-found", `fs.readTextFile: no file at ${file}`);
			}
			return handle.text();
		},
		writeTextFile: async ({
			path,
			contents,
		}: WriteTextFileArgs): Promise<WriteTextFileResult> => {
			const file = requirePath(path);
			if (typeof contents !== "string") {
				throw new CrustError(
					"bad-request",
					'fs.writeTextFile: "contents" must be a string',
				);
			}
			const bytes = await Bun.write(file, contents);
			return { bytes };
		},
		list: async ({ path }: ListArgs): Promise<ListResult> => {
			const dir = requirePath(path);
			const entries = await readdir(dir, { withFileTypes: true }).catch((error: unknown) =>
				missing(error, dir, "list"),
			);
			const listed: ListEntry[] = [];
			for (const entry of entries) {
				const full = resolve(dir, entry.name);
				const info = entry.isDirectory()
					? undefined
					: await statPath(full).catch(() => undefined);
				listed.push({
					name: entry.name,
					path: full,
					directory: entry.isDirectory(),
					size: info?.size ?? 0,
				});
			}
			return { entries: listed.sort((left, right) => left.name.localeCompare(right.name)) };
		},
		stat: async ({ path }: StatArgs): Promise<StatResult> => {
			const target = requirePath(path);
			const info = await statPath(target).catch((error: unknown) =>
				missing(error, target, "stat"),
			);
			return {
				path: absolute(target),
				directory: info.isDirectory(),
				size: info.isDirectory() ? 0 : info.size,
				modified: info.mtimeMs,
			};
		},
		remove: async ({ path, recursive }: RemoveArgs): Promise<RemoveResult> => {
			const target = requirePath(path);
			await rm(target, { recursive: recursive === true }).catch((error: unknown) =>
				missing(error, target, "remove"),
			);
			return { removed: true, path: absolute(target) };
		},
		rename: async ({ from, to }: RenameArgs): Promise<RenameResult> => {
			const source = requirePath(from);
			const destination = requirePath(to);
			await renamePath(source, destination).catch((error: unknown) =>
				missing(error, source, "rename"),
			);
			return { path: absolute(destination) };
		},
	},
});
