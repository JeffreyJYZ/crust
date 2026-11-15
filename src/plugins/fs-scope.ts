/**
 * `crust:fs`'s scope: absolute path prefixes the app may touch. The config's `fs.scope` supplies them, and
 * `fs.scope.allow` widens the list at runtime, persisting the grant to `scope.json` under the app's data
 * directory so it survives a restart. A page client reaches them as `fs.scope.list()` over `fs.scopeList`.
 * No `fs.scope` section means no restriction at all: locking every existing app out of its own files would be
 * a regression, so `check` answers nothing when the section is absent. A `..` walk or a symlink is resolved
 * before the comparison, so neither can land outside a prefix.
 */

import { mkdir, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve, sep } from "node:path";

import { CrustError } from "../bridge/errors";
import { defaultStateRoot } from "./window-persist-store.ts";

/** One file for every grant, so a check never scans a directory. */
export const SCOPE_FILE = "scope.json";

export interface FsScopeOptions {
	/** Configured prefixes. Absent means no restriction; an empty array means nothing is allowed. */
	allow?: readonly string[];
	/** Directory holding `scope.json`. Defaults to the app's data directory. */
	root?: string;
	/** App name for the default root, usually the config's `app.name`. */
	app?: string;
}

export interface FsScope {
	readonly enabled: boolean;
	list(): Promise<string[]>;
	allow(args: unknown): Promise<{ ok: true; paths: string[] }>;
	revoke(args: unknown): Promise<{ ok: true; paths: string[] }>;
	/** Throws `outside-scope` unless `path` resolves inside a prefix; a no-op with nothing configured. */
	check(path: string): Promise<void>;
}

export function outsideScope(path: string): CrustError {
	return new CrustError("outside-scope", `fs: ${path} is outside the app's scope`);
}

/**
 * The real location of a path. A missing leaf resolves through its nearest existing parent, so a check names
 * the directory a write will land in rather than the symlink in front of it.
 */
async function canonical(path: string): Promise<string> {
	const absolute = resolve(path);
	const found = await realpath(absolute).catch(() => undefined);
	if (found !== undefined) return found;
	const parent = dirname(absolute);
	if (parent === absolute) return absolute;
	return join(await canonical(parent), basename(absolute));
}

/** A prefix allows itself and everything under it, never a sibling whose name merely starts the same. */
function contains(prefix: string, target: string): boolean {
	if (target === prefix) return true;
	return target.startsWith(prefix.endsWith(sep) ? prefix : `${prefix}${sep}`);
}

function readPath(args: unknown): string {
	const value = (args as { path?: unknown } | undefined)?.path;
	if (typeof value !== "string" || value.trim() === "") {
		throw new CrustError("bad-request", 'fs.scope: "path" must be a non-empty string');
	}
	if (!isAbsolute(value)) {
		throw new CrustError("bad-request", `fs.scope: ${value} is not an absolute path`);
	}
	return value;
}

/** A missing, unreadable or corrupt file is an empty grant list, never a startup failure. */
async function readStore(file: string): Promise<string[]> {
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

/**
 * A temporary file in the same directory, then a rename: a crash mid-write leaves the previous grants intact
 * rather than a truncated file. `0600` because the list names private directories.
 */
async function writeStore(file: string, paths: string[]): Promise<void> {
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

export function createFsScope(options: FsScopeOptions = {}): FsScope {
	const file = join(options.root ?? defaultStateRoot(options.app ?? "crust"), SCOPE_FILE);
	const enabled = options.allow !== undefined;
	const configured = [...(options.allow ?? [])];
	const persisted = new Set<string>();
	let loaded: Promise<void> | undefined;

	// The factory is synchronous and the read is not, so the merge happens on first use; every command awaits
	// it, and `allow` awaits it before adding, so the file cannot overwrite a grant made during startup.
	const ready = (): Promise<void> =>
		(loaded ??= readStore(file).then((paths) => {
			for (const path of paths) persisted.add(path);
		}));

	const current = async (): Promise<string[]> => {
		await ready();
		const seen = new Set<string>();
		const paths: string[] = [];
		for (const path of [...configured, ...persisted]) {
			const prefix = await canonical(path);
			if (seen.has(prefix)) continue;
			seen.add(prefix);
			paths.push(prefix);
		}
		return paths;
	};

	return {
		enabled,

		list: current,

		check: async (path: string) => {
			if (!enabled) return;
			const target = await canonical(path);
			const prefixes = await current();
			if (prefixes.some((prefix) => contains(prefix, target))) return;
			throw outsideScope(path);
		},

		allow: async (args: unknown) => {
			const path = readPath(args);
			await ready();
			persisted.add(path);
			await writeStore(file, [...persisted]);
			return { ok: true as const, paths: await current() };
		},

		revoke: async (args: unknown) => {
			const target = await canonical(readPath(args));
			await ready();
			let removed = false;
			for (const path of [...persisted]) {
				if ((await canonical(path)) !== target) continue;
				persisted.delete(path);
				removed = true;
			}
			if (removed) await writeStore(file, [...persisted]);
			return { ok: true as const, paths: await current() };
		},
	};
}

/** The three scope commands, spread into the `fs` plugin's own map so they need no second registration. */
export function scopeCommands(scope: FsScope) {
	return {
		scopeList: async (): Promise<{ ok: true; paths: string[] }> => ({
			ok: true,
			paths: await scope.list(),
		}),
		scopeAllow: (args: unknown) => scope.allow(args),
		scopeRevoke: (args: unknown) => scope.revoke(args),
	};
}
