/**
 * `crust:fs` — text files, directories and their metadata. Every failure carries a structured code (`not-found`, `bad-request`, `outside-scope`), and nothing here is synchronous because one blocking handler stalls every other invoke on the bridge (`research/bridge.md` §Concurrency).
 * `list`, `stat`, `remove` and `rename` exist because a real app asked: notes on disk need a listing and a delete, and without them every app reimplements path handling.
 */

import type { Dirent } from "node:fs";
import { readdir, rename as renamePath, rm, stat as statPath } from "node:fs/promises";
import { resolve } from "node:path";

import { CrustError } from "../bridge/errors";
import { definePlugin } from "./define";
import { binaryCommands, type ScopedPath } from "./fs-binary.ts";
import { createFsScope, type FsScopeOptions, scopeCommands } from "./fs-scope.ts";
import { canonical } from "./fs-scope-path.ts";
import type {
	ListArgs,
	ListEntry,
	ListResult,
	ReadTextFileArgs,
	RemoveArgs,
	RemoveResult,
	RenameArgs,
	RenameResult,
	StatArgs,
	StatResult,
	WriteTextFileArgs,
	WriteTextFileResult,
} from "./fs-types.ts";

export type { MkdirArgs, MkdirResult, ReadBinaryArgs } from "./fs-binary.ts";
export type { WriteBinaryArgs, WriteBinaryResult } from "./fs-binary.ts";
export type { FsGrant, FsScopeOptions, FsScopeStatus } from "./fs-scope.ts";
export type {
	ListArgs,
	ListEntry,
	ListResult,
	ReadTextFileArgs,
	RemoveArgs,
	RemoveResult,
	RenameArgs,
	RenameResult,
	StatArgs,
	StatResult,
	WriteTextFileArgs,
	WriteTextFileResult,
} from "./fs-types.ts";

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

	/**
	 * Resolve once, check that resolved path, and hand the same path to the operation. Checking the
	 * caller's raw string and then opening it left a window in which a symlink flip could redirect
	 * the read or write outside the scope; preview already follows this fixed pattern.
	 */
	const scoped = async (value: unknown): Promise<ScopedPath> => {
		if (typeof value !== "string" || value.length === 0) {
			throw new CrustError("bad-request", 'fs: "path" must be a non-empty string');
		}
		const approved = await canonical(value);
		await scope.check(approved);
		return { path: resolve(value), approved };
	};

	/**
	 * The size of one listing entry. A symlink's size is its **target's**, so the target passes the scope
	 * before it is read: without that, a link inside the scope reports the exact size of any file it points
	 * at, which `fs.stat` on that same file correctly refuses. An out-of-scope target is reported as 0.
	 */
	const entrySize = async (entry: Dirent, full: string): Promise<number> => {
		const approved = await canonical(full);
		if (entry.isSymbolicLink()) {
			try {
				await scope.check(approved);
			} catch {
				return 0;
			}
		}
		const info = await statPath(approved).catch(() => undefined);
		return info?.size ?? 0;
	};

	return definePlugin({
		name: "fs",
		commands: {
			readTextFile: async ({ path }: ReadTextFileArgs): Promise<string> => {
				const { approved: file } = await scoped(path);
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
				const { approved: file } = await scoped(path);
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
				const { path: raw, approved: dir } = await scoped(path);
				const entries = await attempt("list", dir, readdir(dir, { withFileTypes: true }));
				const listed: ListEntry[] = [];
				for (const entry of entries) {
					const full = resolve(raw, entry.name);
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
				const { path: raw, approved: target } = await scoped(path);
				const info = await attempt("stat", target, statPath(target));
				return {
					path: raw,
					directory: info.isDirectory(),
					size: info.isDirectory() ? 0 : info.size,
					modified: info.mtimeMs,
				};
			},
			remove: async ({ path, recursive }: RemoveArgs): Promise<RemoveResult> => {
				const { path: raw, approved: target } = await scoped(path);
				await attempt("remove", target, rm(target, { recursive: recursive === true }));
				return { removed: true, path: raw };
			},
			rename: async ({ from, to }: RenameArgs): Promise<RenameResult> => {
				// Both ends: a rename out of a prefix leaks the file as surely as a read.
				const { approved: source } = await scoped(from);
				const { path: raw, approved: destination } = await scoped(to);
				await attempt("rename", source, renamePath(source, destination));
				return { path: raw };
			},
			...binaryCommands(scoped),
			...scopeCommands(scope),
		},
	});
}

/** The default registration: no configured scope, so no restriction. */
export const fsPlugin = createFsPlugin();
