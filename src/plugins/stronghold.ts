/**
 * `crust:stronghold` — Tauri's encrypted store: one JSON file under the app's data directory, every key name and value
 * sealed with AES-256-GCM under a key PBKDF2 derives from the password (parameters in `stronghold-crypto.ts`). Before
 * `open` every command answers `locked`, and a wrong password on an existing file is `bad-password` rather than a fresh
 * empty store — an empty store reads as "you had nothing saved", which is the one answer a locked vault must never give.
 */

import { join } from "node:path";

import { definePlugin } from "./define";
import { createStore, entryId, openStore, seal, unseal } from "./stronghold-crypto.ts";
import { defaultStoreRoot, readStore, STORE_FILE, writeStore } from "./stronghold-file.ts";
import {
	failure,
	reasonOf,
	type CloseResult,
	type DeleteResult,
	type DerivedKeys,
	type GetResult,
	type KeyArgs,
	type KeysResult,
	type OpenArgs,
	type OpenResult,
	type SetArgs,
	type SetResult,
	type StrongholdFailure,
	type StrongholdFile,
	type StrongholdOptions,
} from "./stronghold-types.ts";

export * from "./stronghold-types.ts";
export * from "./stronghold-file.ts";
export * from "./stronghold-crypto.ts";

interface Session {
	file: StrongholdFile;
	keys: DerivedKeys;
}

function locked(command: string): StrongholdFailure {
	return failure("locked", `stronghold.${command} needs open first`);
}

function badRequest(message: string): StrongholdFailure {
	return failure("bad-request", message);
}

function readKey(args: unknown): string | undefined {
	const key = (args as KeyArgs | undefined)?.key;
	return typeof key === "string" && key.length > 0 ? key : undefined;
}

export function createStrongholdPlugin(options: StrongholdOptions = {}) {
	const path = join(options.root ?? defaultStoreRoot(options.app ?? "crust"), STORE_FILE);
	const iterations = options.iterations;
	let session: Session | undefined;
	// One write at a time: two `set` calls racing would each start from the same entries, and the
	// later rename would drop the earlier key.
	let queue: Promise<unknown> = Promise.resolve();

	const serial = <Result>(run: () => Promise<Result>): Promise<Result> => {
		const next = queue.then(run, run);
		queue = next.catch(() => undefined);
		return next;
	};

	return definePlugin({
		name: "stronghold",
		commands: {
			open: async (args: OpenArgs | undefined): Promise<OpenResult | StrongholdFailure> => {
				const password = args?.password;
				if (typeof password !== "string" || password.length === 0) {
					return badRequest("stronghold.open needs a non-empty password");
				}
				try {
					const read = await readStore(path);
					if (!read.ok) return failure(read.code, read.message);
					if (read.file === undefined) {
						const created = await createStore(password, iterations);
						await writeStore(path, created.file);
						session = created;
						return { ok: true, opened: true };
					}
					const opened = await openStore(read.file, password);
					if (!opened.ok) return opened;
					session = opened.store;
					return { ok: true, opened: true };
				} catch (error) {
					return failure("io-error", reasonOf(error));
				}
			},

			close: (): CloseResult => {
				session = undefined;
				return { ok: true, closed: true };
			},

			set: (args: SetArgs) =>
				serial(async (): Promise<SetResult | StrongholdFailure> => {
					const active = session;
					if (active === undefined) return locked("set");
					const key = readKey(args);
					if (key === undefined)
						return badRequest("stronghold.set needs a non-empty key");
					if (typeof args?.value !== "string") {
						return badRequest("stronghold.set needs a string value");
					}
					try {
						const id = await entryId(active.keys.mac, key);
						const entry = {
							name: await seal(active.keys.aes, key),
							value: await seal(active.keys.aes, args.value),
						};
						const file: StrongholdFile = {
							...active.file,
							entries: { ...active.file.entries, [id]: entry },
						};
						await writeStore(path, file);
						// A `close` that landed during the write must not be undone by this one.
						if (session === active) session = { file, keys: active.keys };
						return { ok: true, key };
					} catch (error) {
						return failure("io-error", reasonOf(error));
					}
				}),

			get: async (args: KeyArgs): Promise<GetResult | StrongholdFailure> => {
				const active = session;
				if (active === undefined) return locked("get");
				const key = readKey(args);
				if (key === undefined) return badRequest("stronghold.get needs a non-empty key");
				try {
					const entry = active.file.entries[await entryId(active.keys.mac, key)];
					if (entry === undefined) return failure("not-found", `no entry for ${key}`);
					const value = await unseal(active.keys.aes, entry.value);
					if (value === undefined) {
						return failure("corrupt", `the value for ${key} does not decrypt`);
					}
					return { ok: true, key, value };
				} catch (error) {
					return failure("io-error", reasonOf(error));
				}
			},

			delete: (args: KeyArgs) =>
				serial(async (): Promise<DeleteResult | StrongholdFailure> => {
					const active = session;
					if (active === undefined) return locked("delete");
					const key = readKey(args);
					if (key === undefined)
						return badRequest("stronghold.delete needs a non-empty key");
					try {
						const id = await entryId(active.keys.mac, key);
						if (active.file.entries[id] === undefined) {
							return { ok: true, key, deleted: false };
						}
						const entries = { ...active.file.entries };
						delete entries[id];
						const file: StrongholdFile = { ...active.file, entries };
						await writeStore(path, file);
						if (session === active) session = { file, keys: active.keys };
						return { ok: true, key, deleted: true };
					} catch (error) {
						return failure("io-error", reasonOf(error));
					}
				}),

			keys: async (): Promise<KeysResult | StrongholdFailure> => {
				const active = session;
				if (active === undefined) return locked("keys");
				try {
					const keys: string[] = [];
					for (const entry of Object.values(active.file.entries)) {
						const name = await unseal(active.keys.aes, entry.name);
						if (name === undefined) {
							return failure("corrupt", "a stored key name does not decrypt");
						}
						keys.push(name);
					}
					return { ok: true, keys: keys.sort() };
				} catch (error) {
					return failure("io-error", reasonOf(error));
				}
			},
		},
	});
}

/** The default registration: `~/Library/Application Support/crust/stronghold.json`. */
export const strongholdPlugin = createStrongholdPlugin();
