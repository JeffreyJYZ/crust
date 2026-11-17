/**
 * `crust:store` named stores: two features keep separate keys in separate files under the app data root, and a traversal in a name is refused before it becomes a path. The default (unnamed) store keeps its original `store.json`. Nothing here writes outside a temp root.
 */

import { describe, expect, test } from "bun:test";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	createStorePlugin,
	NAMED_STORE_PREFIX,
	NAMED_STORE_SUFFIX,
	STORE_FILE,
	type StoreGetResult,
	type StoreKeysResult,
	type StoreSetResult,
} from "@/plugins/store";

async function scratch(): Promise<string> {
	return await mkdtemp(join(tmpdir(), "crust-store-named-"));
}

async function call<T>(plugin: ReturnType<typeof createStorePlugin>, name: string, args?: unknown) {
	const table = plugin.commands as unknown as Record<string, (input?: unknown) => unknown>;
	const handler = table[name];
	if (handler === undefined) throw new Error(`no command ${name}`);
	return (await handler(args)) as T;
}

describe("named stores", () => {
	test("two names keep separate keys in separate files; the default stays store.json", async () => {
		const root = await scratch();
		try {
			const plugin = createStorePlugin({ root });
			const alpha = await call<StoreSetResult>(plugin, "set", {
				name: "alpha",
				key: "theme",
				value: "dark",
			});
			const beta = await call<StoreSetResult>(plugin, "set", {
				name: "beta",
				key: "theme",
				value: "light",
			});

			expect(alpha.path).toBe(join(root, `${NAMED_STORE_PREFIX}alpha${NAMED_STORE_SUFFIX}`));
			expect(beta.path).toBe(join(root, `${NAMED_STORE_PREFIX}beta${NAMED_STORE_SUFFIX}`));
			expect(alpha.path).not.toBe(beta.path);

			// Same key, different values: no cross-feature prefixing was needed.
			expect(
				await call<StoreGetResult>(plugin, "get", { name: "alpha", key: "theme" }),
			).toMatchObject({
				value: "dark",
			});
			expect(
				await call<StoreGetResult>(plugin, "get", { name: "beta", key: "theme" }),
			).toMatchObject({
				value: "light",
			});
			expect(await call<StoreKeysResult>(plugin, "keys", { name: "alpha" })).toMatchObject({
				keys: ["theme"],
			});

			// The unnamed store is untouched and still lands in store.json.
			expect(await call<StoreGetResult>(plugin, "get", { key: "theme" })).toMatchObject({
				value: null,
			});
			expect(await call<StoreKeysResult>(plugin, "keys")).toMatchObject({
				path: join(root, STORE_FILE),
				keys: [],
			});
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	test("a named store survives a reopen, proving the file is the source of truth", async () => {
		const root = await scratch();
		try {
			await call<StoreSetResult>(createStorePlugin({ root }), "set", {
				name: "feature",
				key: "n",
				value: 7,
			});
			const reopened = createStorePlugin({ root });
			expect(
				await call<StoreGetResult>(reopened, "get", { name: "feature", key: "n" }),
			).toMatchObject({
				value: 7,
			});
			// All named files live directly under the app data root.
			expect(await readdir(root)).toEqual([
				`${NAMED_STORE_PREFIX}feature${NAMED_STORE_SUFFIX}`,
			]);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	test("a name that would escape the root is refused before a file is made", async () => {
		const root = await scratch();
		try {
			const plugin = createStorePlugin({ root });
			for (const name of ["../escape", "a/b", "..", "a..b", 7]) {
				await expect(
					call(plugin, "set", { name, key: "k", value: 1 }),
				).rejects.toMatchObject({
					code: "bad-request",
				});
			}
			expect(await readdir(root)).toEqual([]);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});
