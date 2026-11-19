/**
 * `crust:store`'s per-store disk state. One file per store under the app data root: the default store stays `store.json`, and a named store gets `store.<name>.json`, so two features can keep separate keys without prefixing strings. The state lives here so `store.ts` stays a thin command table and the corrupt-file quarantine is shared by every store.
 */

import { join } from "node:path";

import { CrustError } from "../bridge/errors";
import { readStore, STORE_FILE, withFileLock, writeStore, type StoreEntries } from "./store-file";

/** Every command's answer base, so a caller learns which file it reached. */
export interface StoreAnswer {
	ok: true;
	/** Absolute path of the store's JSON file. */
	path: string;
	/** Set once, on the first answer after a corrupt file was moved aside. */
	recovered?: string;
}

/** The prefix that keeps a named store's file distinct from the default one. */
export const NAMED_STORE_PREFIX = "store.";
export const NAMED_STORE_SUFFIX = ".json";

/**
 * The file a store name maps to. The empty name is the original `store.json`;
 * a named one is `store.<name>.json`. Name validation lives here, the one place
 * a store name becomes a path, so a traversal can never reach a parent directory.
 */
export function storeFileFor(root: string, name: string): string {
	if (name === "") return join(root, STORE_FILE);
	if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name) || name.includes("..")) {
		throw new CrustError("bad-request", `store: invalid store name ${JSON.stringify(name)}`);
	}
	return join(root, `${NAMED_STORE_PREFIX}${name}${NAMED_STORE_SUFFIX}`);
}

/** One store's lazy load and atomic persist, keyed by its resolved file. */
export class StoreScope {
	readonly file: string;
	private entries: StoreEntries | undefined;
	private recovered: string | undefined;

	constructor(file: string) {
		this.file = file;
	}

	/** Read once on the first command, so a store a page never touches costs no disk access. */
	async loaded(): Promise<StoreEntries> {
		if (this.entries !== undefined) return this.entries;
		const read = await readStore(this.file);
		this.entries = read.entries;
		if (read.corrupt !== undefined) this.recovered = read.corrupt;
		return this.entries;
	}

	/** Called after the work, so a load inside this command reports its recovery in this answer. */
	answer(): StoreAnswer {
		const base: StoreAnswer = { ok: true, path: this.file };
		if (this.recovered !== undefined) {
			base.recovered = this.recovered;
			this.recovered = undefined;
		}
		return base;
	}

	/**
	 * Serialised read-modify-write. Re-reads the file inside the queue so a command in a second
	 * plugin instance — or a concurrent command here — cannot be clobbered by a stale snapshot.
	 * Return `undefined` to leave the file untouched, e.g. deleting a key that was never there.
	 */
	async mutate(run: (current: StoreEntries) => StoreEntries | undefined): Promise<void> {
		await withFileLock(this.file, async () => {
			const read = await readStore(this.file);
			if (read.corrupt !== undefined) this.recovered = read.corrupt;
			const next = run(read.entries);
			if (next === undefined) return;
			await writeStore(this.file, next);
			this.entries = next;
		});
	}
}
