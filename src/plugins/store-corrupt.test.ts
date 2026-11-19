/**
 * `crust:store`'s two failure paths against a temp root: a file that is not a JSON object is moved aside once (`store.json.corrupt`) and reported on the next answer only, and a value JSON cannot hold is a `bad-request` naming its key that never reaches the disk.
 */

import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	createStorePlugin,
	STORE_FILE,
	type StoreGetResult,
	type StoreKeysResult,
	type StoreSetResult,
} from "@/plugins/store";

async function scratch(): Promise<string> {
	return await mkdtemp(join(tmpdir(), "crust-store-corrupt-"));
}

async function call<T>(plugin: ReturnType<typeof createStorePlugin>, name: string, args?: unknown) {
	const table = plugin.commands as unknown as Record<string, (input?: unknown) => unknown>;
	const handler = table[name];
	if (handler === undefined) throw new Error(`no command ${name}`);
	return (await handler(args)) as T;
}

describe("store recovery", () => {
	test("a corrupt file is moved aside once and the next answer says so", async () => {
		const root = await scratch();
		try {
			const file = join(root, STORE_FILE);
			await writeFile(file, '{"ui": {"theme": "da');
			const plugin = createStorePlugin({ root });
			const first = await call<StoreGetResult>(plugin, "get", { key: "ui" });
			expect(first.value).toBeNull();
			expect(first.recovered).toBe(`${file}.corrupt`);
			// One report only: the second answer must not keep claiming a loss that already happened.
			expect(
				(await call<StoreGetResult>(plugin, "get", { key: "ui" })).recovered,
			).toBeUndefined();
			expect(await readFile(`${file}.corrupt`, "utf8")).toBe('{"ui": {"theme": "da');
			await call<StoreSetResult>(plugin, "set", { key: "ui", value: "fresh" });
			expect(JSON.parse(await readFile(file, "utf8"))).toEqual({ ui: "fresh" });
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	test("a corrupt file whose quarantine rename fails does not claim recovery", async () => {
		const root = await scratch();
		try {
			const file = join(root, STORE_FILE);
			await writeFile(file, '{"ui": {"theme": "da');
			// A directory at the quarantine target makes the rename fail, so the corrupt
			// bytes are still on disk. The answer must not claim they were preserved.
			await mkdir(`${file}.corrupt`);
			const plugin = createStorePlugin({ root });
			const result = await call<StoreGetResult>(plugin, "get", { key: "ui" });
			expect(result.value).toBeNull();
			expect(result.recovered).toBeUndefined();
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	test("an array at the top level is corrupt too, not a key table", async () => {
		const root = await scratch();
		try {
			await writeFile(join(root, STORE_FILE), "[1, 2]");
			const keys = await call<StoreKeysResult>(createStorePlugin({ root }), "keys");
			expect(keys.keys).toEqual([]);
			expect(keys.recovered).toBe(join(root, `${STORE_FILE}.corrupt`));
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});

describe("store refusals", () => {
	test("an unsupported value or key is a bad-request and touches no disk", async () => {
		const root = await scratch();
		try {
			const plugin = createStorePlugin({ root });
			const cycle: Record<string, unknown> = {};
			cycle.self = cycle;
			const refusals: [string, unknown][] = [
				["gone", undefined],
				["fn", () => 1],
				["loop", cycle],
				["when", new Date(0)],
				["nan", Number.NaN],
			];
			for (const [key, value] of refusals) {
				await expect(call(plugin, "set", { key, value })).rejects.toMatchObject({
					code: "bad-request",
					message: expect.stringContaining(key),
				});
			}
			// A refused write reaches no disk, so no `null` was stored in place of the value either.
			expect(
				await readFile(join(root, STORE_FILE), "utf8").catch(() => undefined),
			).toBeUndefined();
			await expect(call(plugin, "get", { key: "" })).rejects.toMatchObject({
				code: "bad-request",
			});
			await expect(call(plugin, "delete", { key: 7 })).rejects.toMatchObject({
				code: "bad-request",
			});
			expect(await readdir(root)).toEqual([]);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});
