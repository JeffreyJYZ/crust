/**
 * Concurrent store mutations. The store is a read-modify-write over one file, so two commands
 * fired together must not build their result from the same stale snapshot — the later commit
 * would otherwise drop the earlier key. Nothing here writes outside a temp root.
 */

import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createStorePlugin, STORE_FILE } from "@/plugins/store";

async function scratch(): Promise<string> {
	return await mkdtemp(join(tmpdir(), "crust-store-concurrent-"));
}

async function call(plugin: ReturnType<typeof createStorePlugin>, name: string, args?: unknown) {
	const table = plugin.commands as unknown as Record<string, (input?: unknown) => unknown>;
	const handler = table[name];
	if (handler === undefined) throw new Error(`no command ${name}`);
	return await handler(args);
}

describe("concurrent store mutations", () => {
	test("two sets in one instance both survive", async () => {
		const root = await scratch();
		try {
			const plugin = createStorePlugin({ root });
			await call(plugin, "set", { key: "seed", value: 0 });
			await Promise.all([
				call(plugin, "set", { key: "a", value: 1 }),
				call(plugin, "set", { key: "b", value: 2 }),
			]);
			expect(JSON.parse(await readFile(join(root, STORE_FILE), "utf8"))).toEqual({
				seed: 0,
				a: 1,
				b: 2,
			});
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	test("a second instance writing the same file is not clobbered", async () => {
		const root = await scratch();
		try {
			// Seed the file and load it into both caches, so each instance holds the same
			// stale snapshot before the two writes begin.
			await writeFile(join(root, STORE_FILE), JSON.stringify({ seed: 0 }));
			const one = createStorePlugin({ root });
			const two = createStorePlugin({ root });
			await call(one, "get", { key: "seed" });
			await call(two, "get", { key: "seed" });
			await Promise.all([
				call(one, "set", { key: "a", value: 1 }),
				call(two, "set", { key: "b", value: 2 }),
			]);
			expect(JSON.parse(await readFile(join(root, STORE_FILE), "utf8"))).toEqual({
				seed: 0,
				a: 1,
				b: 2,
			});
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});
