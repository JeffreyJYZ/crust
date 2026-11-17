/**
 * `crust:fs` — text files, directories and their metadata. Every failure carries a structured code (`not-found`, `bad-request`, `outside-scope`), and nothing here is synchronous because one blocking handler stalls every other invoke on the bridge (`research/bridge.md` §Concurrency).
 * `list`, `stat`, `remove` and `rename` exist because a real app asked: notes on disk need a listing and a delete, and without them every app reimplements path handling.
 */

import type { Dirent } from "node:fs";
import { readdir, rename as renamePath, rm, stat as statPath } from "node:fs/promises";
import { resolve } from "node:path";

import { CrustError } from "../bridge/errors";
import { definePlugin } from "./define";
import { binaryCommands } from "./fs-binary.ts";
import { createFsScope, type FsScopeOptions, scopeCommands } from "./fs-scope.ts";

export type { MkdirArgs, MkdirResult, ReadBinaryArgs } from "./fs-binary.ts";
export type { WriteBinaryArgs, WriteBinaryResult } from "./fs-binary.ts";
export type { FsGrant, FsScopeOptions, FsScopeStatus } from "./fs-scope.ts";

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

/** A missing path is `not-found`, which is the one filesystem error worth naming. */
function missing(error: unknown, path: string, command: string): never {
	const code = (error as { code?: string } | undefined)?.code;
	if (code === "ENOENT") throw new CrustError("not-found", `fs.${command}: no path at ${path}`);
	throw error;
}

/** Run one filesystem call, naming it and the path when it fails. */
function attempt<Result>(command: string, path: string, run: Promise<Result>): Promise<Result> {
	return run.catch((error: unknown) => missing(error, path, command));
}

/** The plugin, with the config's `fs.scope` (and any persisted grant) as its boundary. */
export function createFsPlugin(options: FsScopeOptions = {}) {
	const scope = createFsScope(options);

	/** A path argument, refused unless it resolves inside the scope. No-op with nothing configured. */
	const scoped = async (value: unknown): Promise<string> => {
		if (typeof value !== "string" || value.length === 0) {
			throw new CrustError("bad-request", 'fs: "path" must be a non-empty string');
		}
		await scope.check(value);
		return value;
	};

	/**
	 * The size of one listing entry. A symlink's size is its **target's**, so the target passes the scope
	 * before it is read: without that, a link inside the scope reports the exact size of any file it points
	 * at, which `fs.stat` on that same file correctly refuses. An out-of-scope target is reported as 0.
	 */
	const entrySize = async (entry: Dirent, full: string): Promise<number> => {
		if (entry.isSymbolicLink()) {
			try {
				await scope.check(full);
			} catch {
				return 0;
			}
		}
		const info = await statPath(full).catch(() => undefined);
		return info?.size ?? 0;
	};

	return definePlugin({
		name: "fs",
		commands: {
			readTextFile: async ({ path }: ReadTextFileArgs): Promise<string> => {
				const file = await scoped(path);
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
				const file = await scoped(path);
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
				const dir = await scoped(path);
				const entries = await attempt("list", dir, readdir(dir, { withFileTypes: true }));
				const listed: ListEntry[] = [];
				for (const entry of entries) {
					const full = resolve(dir, entry.name);
					listed.push({
						name: entry.name,
						path: full,
						directory: entry.isDirectory(),
						size: entry.isDirectory() ? 0 : await entrySize(entry, full),
					});
				}
				return {
					entries: listed.sort((left, right) => left.name.localeCompare(right.name)),
				};
			},
			stat: async ({ path }: StatArgs): Promise<StatResult> => {
				const target = await scoped(path);
				const info = await attempt("stat", target, statPath(target));
				return {
					path: resolve(target),
					directory: info.isDirectory(),
					size: info.isDirectory() ? 0 : info.size,
					modified: info.mtimeMs,
				};
			},
			remove: async ({ path, recursive }: RemoveArgs): Promise<RemoveResult> => {
				const target = await scoped(path);
				await attempt("remove", target, rm(target, { recursive: recursive === true }));
				return { removed: true, path: resolve(target) };
			},
			rename: async ({ from, to }: RenameArgs): Promise<RenameResult> => {
				// Both ends: a rename out of a prefix leaks the file as surely as a read.
				const source = await scoped(from);
				const destination = await scoped(to);
				await attempt("rename", source, renamePath(source, destination));
				return { path: resolve(destination) };
			},
			...binaryCommands(scoped),
			...scopeCommands(scope),
		},
	});
}

/** The default registration: no configured scope, so no restriction. */
export const fsPlugin = createFsPlugin();
