/**
 * `crust:store` — Tauri's persistent key-value store: one JSON object under the app's data directory, held in memory so a read costs nothing and written atomically on every change. A corrupt file is moved aside once (`store.json.corrupt`) and the store starts empty, which the next answer reports as `recovered` so a page can tell it lost data instead of mistaking it for a missing key.
 */

import { join } from "node:path";

import { CrustError } from "../bridge/errors";
import { definePlugin } from "./define";
import {
	assertJsonValue,
	CORRUPT_SUFFIX,
	defaultStoreRoot,
	readStore,
	STORE_FILE,
	type StoreEntries,
	writeStore,
} from "./store-file";

export { CORRUPT_SUFFIX, defaultStoreRoot, STORE_FILE, type StoreEntries };

/** Where the file goes; a test injects a temp root, an app names its own id. */
export interface StoreAdapter {
	/** Data directory the `store.json` sits under. */
	root?: string;
	/** Bundle id naming the default root, `~/Library/Application Support/<id>`. */
	appId?: string;
	home?: string;
}

export interface StoreGetArgs {
	key: string;
}

export interface StoreSetArgs {
	key: string;
	/** Anything JSON holds unchanged; `undefined`, a function or a cycle is a `bad-request`. */
	value: unknown;
}

export interface StoreKeyArgs {
	key: string;
}

/** Every command's answer, so a caller learns where the file is without joining strings. */
export interface StoreAnswer {
	ok: true;
	/** Absolute path of `store.json`. */
	path: string;
	/** Set once, on the first answer after a corrupt file was moved aside. */
	recovered?: string;
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

export function createStorePlugin(adapter: StoreAdapter = {}) {
	const file = join(
		adapter.root ?? defaultStoreRoot(adapter.appId ?? "crust", adapter.home),
		STORE_FILE,
	);
	/** Read once on the first command, so a store a page never touches costs no disk access. */
	let entries: StoreEntries | undefined;
	/** Set by the load that moved a corrupt file aside, cleared by the answer that reports it. */
	let recovered: string | undefined;

	async function loaded(): Promise<StoreEntries> {
		if (entries !== undefined) return entries;
		const read = await readStore(file);
		entries = read.entries;
		recovered = read.corrupt;
		return entries;
	}

	/** Called after the work, so a load inside this command reports its recovery in this answer. */
	function answer(): StoreAnswer {
		const base: StoreAnswer = { ok: true, path: file };
		if (recovered !== undefined) {
			base.recovered = recovered;
			recovered = undefined;
		}
		return base;
	}

	async function persist(next: StoreEntries): Promise<void> {
		await writeStore(file, next);
		entries = next;
	}

	return definePlugin({
		name: "store",
		commands: {
			get: async ({ key }: StoreGetArgs): Promise<StoreGetResult> => {
				const name = requireKey(key, "get");
				const current = await loaded();
				return { ...answer(), value: Object.hasOwn(current, name) ? current[name] : null };
			},
			set: async ({ key, value }: StoreSetArgs): Promise<StoreSetResult> => {
				const name = requireKey(key, "set");
				assertJsonValue(value, name);
				const current = await loaded();
				// Store the JSON round trip, so what a later `get` answers is what is on disk and a
				// caller mutating its own object cannot drift the in-memory copy.
				const stored = JSON.parse(JSON.stringify(value)) as unknown;
				await persist({ ...current, [name]: stored });
				return { ...answer(), key: name };
			},
			delete: async ({ key }: StoreKeyArgs): Promise<StoreDeleteResult> => {
				const name = requireKey(key, "delete");
				const current = await loaded();
				if (!Object.hasOwn(current, name))
					return { ...answer(), key: name, existed: false };
				const next = { ...current };
				delete next[name];
				await persist(next);
				return { ...answer(), key: name, existed: true };
			},
			keys: async (): Promise<StoreKeysResult> => {
				const current = await loaded();
				// Code-unit order, so the list is the same on every machine and locale.
				return { ...answer(), keys: Object.keys(current).sort() };
			},
			clear: async (): Promise<StoreClearResult> => {
				const current = await loaded();
				const cleared = Object.keys(current).length;
				await persist({});
				return { ...answer(), cleared };
			},
			save: async (): Promise<StoreSaveResult> => {
				const current = await loaded();
				await persist({ ...current });
				return { ...answer(), keys: Object.keys(current).length };
			},
		},
	});
}

/** The default registration: `~/Library/Application Support/crust/store.json` until an app names itself. */
export const storePlugin = createStorePlugin();
