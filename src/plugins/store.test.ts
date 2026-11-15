/**
 * `crust:store` against a temp root: the round trip, where the file lands and its mode, the sorted key list and the save that makes the file explicit. The corrupt-file and refusal paths live in `store-corrupt.test.ts`. Nothing here writes outside the temp directory.
 */

import { describe, expect, test } from "bun:test";
import { mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	createStorePlugin,
	defaultStoreRoot,
	STORE_FILE,
	type StoreClearResult,
	type StoreDeleteResult,
	type StoreGetResult,
	type StoreKeysResult,
	type StoreSaveResult,
	type StoreSetResult,
} from "@/plugins/store";

async function scratch(): Promise<string> {
	return await mkdtemp(join(tmpdir(), "crust-store-"));
}

async function call<T>(plugin: ReturnType<typeof createStorePlugin>, name: string, args?: unknown) {
	const table = plugin.commands as unknown as Record<string, (input?: unknown) => unknown>;
	const handler = table[name];
	if (handler === undefined) throw new Error(`no command ${name}`);
	return (await handler(args)) as T;
}

describe("store round trip", () => {
	test("a value survives set, get and a second plugin on the same file", async () => {
		const root = await scratch();
		try {
			const plugin = createStorePlugin({ root });
			const settings = { theme: "dark", width: 1200, tags: ["a", "b"], nested: { on: true } };
			expect(
				await call<StoreSetResult>(plugin, "set", { key: "ui", value: settings }),
			).toEqual({
				ok: true,
				key: "ui",
				path: join(root, STORE_FILE),
			});
			expect(await call<StoreGetResult>(plugin, "get", { key: "ui" })).toEqual({
				ok: true,
				path: join(root, STORE_FILE),
				value: settings,
			});
			// A second instance proves the file is the source of truth, not the first one's memory.
			const reopened = createStorePlugin({ root });
			expect(await call<StoreGetResult>(reopened, "get", { key: "ui" })).toMatchObject({
				value: settings,
			});
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	test("a key that was never set reads as null, and a stored null reads the same", async () => {
		const root = await scratch();
		try {
			const plugin = createStorePlugin({ root });
			expect(await call<StoreGetResult>(plugin, "get", { key: "missing" })).toMatchObject({
				value: null,
			});
			await call<StoreSetResult>(plugin, "set", { key: "empty", value: null });
			expect(await call<StoreGetResult>(plugin, "get", { key: "empty" })).toMatchObject({
				value: null,
			});
			expect(await call<StoreKeysResult>(plugin, "keys")).toMatchObject({ keys: ["empty"] });
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});

describe("store keys", () => {
	test("keys are sorted, delete reports whether it existed, clear empties the store", async () => {
		const root = await scratch();
		try {
			const plugin = createStorePlugin({ root });
			for (const key of ["zeta", "alpha", "mike"]) {
				await call<StoreSetResult>(plugin, "set", { key, value: key.length });
			}
			expect(await call<StoreKeysResult>(plugin, "keys")).toMatchObject({
				keys: ["alpha", "mike", "zeta"],
			});
			const deleteKey = async (key: string): Promise<StoreDeleteResult> =>
				await call<StoreDeleteResult>(plugin, "delete", { key });
			expect(await deleteKey("mike")).toMatchObject({ key: "mike", existed: true });
			expect(await deleteKey("mike")).toMatchObject({ key: "mike", existed: false });
			expect(await call<StoreKeysResult>(plugin, "keys")).toMatchObject({
				keys: ["alpha", "zeta"],
			});
			expect(await call<StoreClearResult>(plugin, "clear")).toMatchObject({ cleared: 2 });
			expect(await call<StoreKeysResult>(plugin, "keys")).toMatchObject({ keys: [] });
			// The empty store is still a readable file, so a reload sees nothing rather than "corrupt".
			expect(JSON.parse(await readFile(join(root, STORE_FILE), "utf8"))).toEqual({});
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});

describe("store file", () => {
	test("lands under the injected root, is 0600 and leaves no temp file behind", async () => {
		const root = await scratch();
		try {
			const plugin = createStorePlugin({ root });
			expect(await call<StoreSaveResult>(plugin, "save")).toMatchObject({
				ok: true,
				path: join(root, STORE_FILE),
				keys: 0,
			});
			await call<StoreSetResult>(plugin, "set", { key: "one", value: 1 });
			expect((await stat(join(root, STORE_FILE))).mode & 0o777).toBe(0o600);
			expect(await readdir(root)).toEqual([STORE_FILE]);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	test("the default root is the app's Application Support directory", () => {
		expect(defaultStoreRoot("land.jyz.app", "/home/jyz")).toBe(
			join("/home/jyz", "Library", "Application Support", "land.jyz.app"),
		);
		const previous = process.env.CRUST_DATA_DIR;
		process.env.CRUST_DATA_DIR = "/tmp/crust-data";
		try {
			expect(defaultStoreRoot("ignored", "/home/jyz")).toBe("/tmp/crust-data");
		} finally {
			if (previous === undefined) delete process.env.CRUST_DATA_DIR;
			else process.env.CRUST_DATA_DIR = previous;
		}
	});
});
