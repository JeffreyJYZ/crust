/**
 * `crust:store` — Tauri's persistent key-value store: one JSON object under the app's data directory, held in memory so a read costs nothing and written atomically on every change. A corrupt file is moved aside once (`store.json.corrupt`) and the store starts empty, which the next answer reports as `recovered` so a page can tell it lost data instead of mistaking it for a missing key.
 * Every command takes an optional `{ name }`: the empty name is the original `store.json`, a named one is its own `store.<name>.json` file, so two features keep separate keys without prefixing strings. Scopes are created lazily and cached per name.
 */

import { CrustError } from "../bridge/errors";
import { definePlugin } from "./define";
import {
	assertJsonValue,
	CORRUPT_SUFFIX,
	defaultStoreRoot,
	STORE_FILE,
	type StoreEntries,
} from "./store-file";
import { StoreScope, storeFileFor, type StoreAnswer } from "./store-scope";

export { CORRUPT_SUFFIX, defaultStoreRoot, STORE_FILE, type StoreEntries };
export {
	NAMED_STORE_PREFIX,
	NAMED_STORE_SUFFIX,
	storeFileFor,
	type StoreAnswer,
} from "./store-scope";

/** Where the store files go; a test injects a temp root, an app names its own id. */
export interface StoreAdapter {
	/** Data directory the store files sit under. */
	root?: string;
	/** Bundle id naming the default root, `~/Library/Application Support/<id>`. */
	appId?: string;
	home?: string;
}

/** The optional store name every command accepts. */
export interface StoreNamedArgs {
	name?: string;
}

export interface StoreGetArgs extends StoreNamedArgs {
	key: string;
}

export interface StoreSetArgs extends StoreNamedArgs {
	key: string;
	/** Anything JSON holds unchanged; `undefined`, a function or a cycle is a `bad-request`. */
	value: unknown;
}

export interface StoreKeyArgs extends StoreNamedArgs {
	key: string;
}

export interface StoreGetResult extends StoreAnswer {
	/** `null` for a key that was never set, which is also what a stored `null` reads as. */
	value: unknown | null;
}

export interface StoreSetResult extends StoreAnswer {
	key: string;
}

export interface StoreDeleteResult extends StoreAnswer {
	key: string;
	existed: boolean;
}

export interface StoreKeysResult extends StoreAnswer {
	keys: string[];
}

export interface StoreClearResult extends StoreAnswer {
	cleared: number;
}

export interface StoreSaveResult extends StoreAnswer {
	keys: number;
}

function requireKey(value: unknown, command: string): string {
	if (typeof value !== "string" || value.length === 0) {
		throw new CrustError("bad-request", `store.${command}: "key" must be a non-empty string`);
	}
	return value;
}

/** Read the optional store name; a present but wrong-typed value is the caller's error. */
function readName(args: unknown): string {
	if (args === undefined || args === null) return "";
	if (typeof args !== "object") {
		throw new CrustError("bad-request", "store: command args must be an object");
	}
	const value = (args as { name?: unknown }).name;
	if (value === undefined) return "";
	if (typeof value !== "string") {
		throw new CrustError("bad-request", 'store: "name" must be a string when given');
	}
	return value;
}

export function createStorePlugin(adapter: StoreAdapter = {}) {
	const root = adapter.root ?? defaultStoreRoot(adapter.appId ?? "crust", adapter.home);
	/** One scope per name, created on first use and reused for the life of the plugin. */
	const scopes = new Map<string, StoreScope>();
	const scopeFor = (name: string): StoreScope => {
		const existing = scopes.get(name);
		if (existing !== undefined) return existing;
		const created = new StoreScope(storeFileFor(root, name));
		scopes.set(name, created);
		return created;
	};
	const forArgs = (args: unknown): StoreScope => scopeFor(readName(args));

	return definePlugin({
		name: "store",
		commands: {
			get: async (args: StoreGetArgs): Promise<StoreGetResult> => {
				const store = forArgs(args);
				const name = requireKey(args.key, "get");
				const current = await store.loaded();
				return {
					...store.answer(),
					value: Object.hasOwn(current, name) ? current[name] : null,
				};
			},
			set: async (args: StoreSetArgs): Promise<StoreSetResult> => {
				const store = forArgs(args);
				const name = requireKey(args.key, "set");
				assertJsonValue(args.value, name);
				const current = await store.loaded();
				// Store the JSON round trip, so what a later `get` answers is what is on disk and a
				// caller mutating its own object cannot drift the in-memory copy.
				const stored = JSON.parse(JSON.stringify(args.value)) as unknown;
				await store.persist({ ...current, [name]: stored });
				return { ...store.answer(), key: name };
			},
			delete: async (args: StoreKeyArgs): Promise<StoreDeleteResult> => {
				const store = forArgs(args);
				const name = requireKey(args.key, "delete");
				const current = await store.loaded();
				if (!Object.hasOwn(current, name))
					return { ...store.answer(), key: name, existed: false };
				const next = { ...current };
				delete next[name];
				await store.persist(next);
				return { ...store.answer(), key: name, existed: true };
			},
			keys: async (args?: StoreNamedArgs): Promise<StoreKeysResult> => {
				const store = forArgs(args);
				const current = await store.loaded();
				// Code-unit order, so the list is the same on every machine and locale.
				return { ...store.answer(), keys: Object.keys(current).sort() };
			},
			clear: async (args?: StoreNamedArgs): Promise<StoreClearResult> => {
				const store = forArgs(args);
				const current = await store.loaded();
				const cleared = Object.keys(current).length;
				await store.persist({});
				return { ...store.answer(), cleared };
			},
			save: async (args?: StoreNamedArgs): Promise<StoreSaveResult> => {
				const store = forArgs(args);
				const current = await store.loaded();
				await store.persist({ ...current });
				return { ...store.answer(), keys: Object.keys(current).length };
			},
		},
	});
}

/** The default registration: `~/Library/Application Support/crust/store.json` until an app names itself. */
export const storePlugin = createStorePlugin();
