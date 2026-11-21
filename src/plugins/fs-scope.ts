/**
 * `crust:fs`'s scope: absolute path prefixes the app may touch. The config's `fs.scope` supplies them.
 *
 * **A page may not widen its own boundary.** `fs.scopeAllow` appends a prefix and persists it to
 * `scope.json`, so leaving it reachable made the boundary writable by the thing it bounds. It is
 * refused with `outside-scope` unless the host opted in by building the plugin with
 * `grants: "page"`; the grant belongs to the host (`fs.scope` in the config, or `createFsScope().allow`),
 * because a page-reachable grant is a page-reachable boundary.
 *
 * **No `fs.scope` section means no restriction at all**, which every existing app relies on, so that
 * default is unchanged and `fs.scopeList` reports `scoped: false` instead: an app author can see the
 * boundary is absent rather than assume one exists.
 *
 * **The store is the plugin's state, not app data.** `scope.json` sits in the app's data directory, which
 * is exactly where a page may write, so a page could grant itself any prefix by writing the file the next
 * launch reads. No page command may therefore address it — `check` refuses the store's own canonical path
 * whatever the scope says, including when no scope is configured. An HMAC over the entries cannot replace
 * that: an unscoped app's page reads every file the user can read, so any key on disk is readable, a
 * per-process key would break the restart persistence a host grant needs, and a Keychain key lives in
 * `src/platform/**`.
 *
 * A `..` walk or a symlink is resolved before the comparison, so neither can land outside a prefix.
 */

import { join } from "node:path";

import { CrustError } from "../bridge/errors";
import { rememberScopedFsScope } from "./fs-scope-in-force.ts";
import { canonical, contains, outsideScope, readPath, samePath } from "./fs-scope-path.ts";
import { readStore, SCOPE_FILE, writeStore } from "./fs-scope-store.ts";
import { defaultStateRoot } from "./window-persist-store.ts";

export { outsideScope } from "./fs-scope-path.ts";
export { SCOPE_FILE } from "./fs-scope-store.ts";

/** Who may grant a prefix: the host (`runtime`), or a page command (`page`, an explicit opt-in). */
export type FsGrant = "runtime" | "page";

export interface FsScopeOptions {
	/** Configured prefixes. Absent means no restriction; an empty array means nothing is allowed. */
	allow?: readonly string[];
	/** Directory holding `scope.json`. Defaults to the app's data directory. */
	root?: string;
	/** App name for the default root, usually the config's `app.name`. */
	app?: string;
	/** Whether `fs.scopeAllow` is reachable from the page. Defaults to `"runtime"`, which refuses it. */
	grants?: FsGrant;
}

/** What `fs.scopeList` answers: the prefixes in force, and whether there is a boundary at all. */
export interface FsScopeStatus {
	ok: true;
	paths: string[];
	/** False when no `fs.scope` is configured: `fs` can then read and write every file this user can. */
	scoped: boolean;
	/** Present only when `scoped` is false, naming what is missing. */
	reason?: string;
}

export interface FsScope {
	readonly enabled: boolean;
	readonly grants: FsGrant;
	status(): Promise<FsScopeStatus>;
	list(): Promise<string[]>;
	/** A host-side grant. `fs.scopeAllow` reaches this only with `grants: "page"`. */
	allow(args: unknown): Promise<{ ok: true; paths: string[] }>;
	revoke(args: unknown): Promise<{ ok: true; paths: string[] }>;
	/** Throws `outside-scope` unless `path` resolves inside a prefix; a no-op with nothing configured. */
	check(path: string): Promise<void>;
}

const UNSCOPED =
	"fs.scope is not configured, so fs reads and writes every file this user can; add fs.scope to the app config to set a boundary";

/** A page addressed the store: named so a page author reads the fix rather than a bare 403. */
export function storeRefused(path: string): CrustError {
	return new CrustError(
		"outside-scope",
		`fs: ${path} is the fs scope store (${SCOPE_FILE}), which no page command may touch — grants come from the host, through fs.scope in the app config or createFsPlugin({ allow })`,
	);
}

export function createFsScope(options: FsScopeOptions = {}): FsScope {
	const file = join(options.root ?? defaultStateRoot(options.app ?? "crust"), SCOPE_FILE);
	const enabled = options.allow !== undefined;
	const grants: FsGrant = options.grants ?? "runtime";
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

	// Resolved once: the store's own canonical path, which no page command may address even before the file
	// exists, so the guard cannot be dodged by writing it first.
	let storePath: Promise<string> | undefined;
	const store = (): Promise<string> => (storePath ??= canonical(file));

	const scope: FsScope = {
		enabled,
		grants,

		list: current,

		status: async () => {
			const paths = await current();
			return enabled
				? { ok: true as const, paths, scoped: true as const }
				: { ok: true as const, paths, scoped: false as const, reason: UNSCOPED };
		},

		check: async (path: string) => {
			const target = await canonical(path);
			// Before the scope test and before the unscoped shortcut: the store is not app data at any setting.
			if (samePath(target, await store())) throw storeRefused(path);
			if (!enabled) return;
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
	// Recorded here rather than in `createFsPlugin`, so every host that builds a scope is covered:
	// the runtime's `fs.scope` instance is the one `preview` inherits. An unscoped app records nothing.
	if (enabled) rememberScopedFsScope(scope);
	return scope;
}

/** Why a page-reachable grant is refused, named so a page author reads the fix rather than a bare 403. */
export function grantRefused(): CrustError {
	return new CrustError(
		"outside-scope",
		'fs.scopeAllow: refused — a page may not widen its own scope (grants is "runtime"); the host grants a path through fs.scope in the app config, or by building the plugin with grants: "page"',
	);
}

/**
 * The scope commands, spread into the `fs` plugin's own map so they need no second registration.
 * `scopeAllow` is refused before its argument is even read, so a malformed call names the real reason.
 * `scopeRevoke` stays reachable: it can only take a grant away, never widen the boundary.
 */
export function scopeCommands(scope: FsScope) {
	return {
		scopeList: (): Promise<FsScopeStatus> => scope.status(),
		scopeAllow: (args: unknown) => {
			if (scope.grants !== "page") throw grantRefused();
			return scope.allow(args);
		},
		scopeRevoke: (args: unknown) => scope.revoke(args),
	};
}
