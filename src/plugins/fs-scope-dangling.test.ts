/**
 * A symlink whose target does not exist yet is the one shape a parent-only canonicalisation gets wrong:
 * `realpath` fails, the link's own path is inside the scope, and the write still follows the link. These
 * cases drive the real plugin against a real temp tree, so the refusal is the code's, not the test's.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createFsPlugin } from "@/plugins/fs";

type Plugin = ReturnType<typeof createFsPlugin>;

const roots: string[] = [];

async function scratch(): Promise<{ root: string; inside: string; outside: string }> {
	const root = await realpath(await mkdtemp(join(tmpdir(), "crust-dangling-")));
	roots.push(root);
	const inside = join(root, "scope");
	const outside = join(root, "outside");
	await mkdir(inside, { recursive: true });
	await mkdir(outside, { recursive: true });
	return { root, inside, outside };
}

async function call<T>(plugin: Plugin, name: string, args?: unknown): Promise<T> {
	const handler = (plugin.commands as Record<string, (input: unknown) => Promise<unknown>>)[name];
	if (handler === undefined) throw new Error(`no command ${name}`);
	return (await handler(args)) as T;
}

afterEach(async () => {
	for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

describe("a dangling symlink and the fs scope", () => {
	test("a write through a dangling in-scope symlink is refused, and the target stays absent", async () => {
		const { root, inside, outside } = await scratch();
		const target = join(outside, "secret.txt");
		const link = join(inside, "link.txt");
		await symlink(target, link);
		const plugin = createFsPlugin({ allow: [inside], root });
		await expect(
			call(plugin, "writeTextFile", { path: link, contents: "PWNED" }),
		).rejects.toMatchObject({ code: "outside-scope" });
		await expect(Bun.file(target).exists()).resolves.toBe(false);
	});

	test("a read through the same dangling link is refused too", async () => {
		const { root, inside, outside } = await scratch();
		const link = join(inside, "link.txt");
		await symlink(join(outside, "secret.txt"), link);
		const plugin = createFsPlugin({ allow: [inside], root });
		await expect(call(plugin, "readTextFile", { path: link })).rejects.toMatchObject({
			code: "outside-scope",
		});
	});

	test("a dangling link that points back inside the scope still works", async () => {
		const { root, inside } = await scratch();
		const link = join(inside, "future.txt");
		await symlink(join(inside, "made-later.txt"), link);
		const plugin = createFsPlugin({ allow: [inside], root });
		const written = await call<{ bytes: number }>(plugin, "writeTextFile", {
			path: join(inside, "made-later.txt"),
			contents: "kept",
		});
		expect(written.bytes).toBe(4);
		expect(await call<string>(plugin, "readTextFile", { path: link })).toBe("kept");
	});
});

describe("a symlink and the size fs.list reports", () => {
	test("a link to an out-of-scope file reports 0, not the target's size", async () => {
		const { root, inside, outside } = await scratch();
		const secret = join(outside, "secret.dat");
		await writeFile(secret, "x".repeat(12345), "utf8");
		await symlink(secret, join(inside, "leak.dat"));
		const plugin = createFsPlugin({ allow: [inside], root });
		const { entries } = await call<{
			entries: Array<{ name: string; path: string; directory: boolean; size: number }>;
		}>(plugin, "list", { path: inside });
		expect(entries).toEqual([
			{ name: "leak.dat", path: join(inside, "leak.dat"), directory: false, size: 0 },
		]);
		await expect(call(plugin, "stat", { path: secret })).rejects.toMatchObject({
			code: "outside-scope",
		});
	});

	test("a link to an in-scope file still reports the target's size", async () => {
		const { root, inside } = await scratch();
		const kept = join(inside, "kept.dat");
		await writeFile(kept, "1234", "utf8");
		await symlink(kept, join(inside, "alias.dat"));
		const plugin = createFsPlugin({ allow: [inside], root });
		const { entries } = await call<{ entries: Array<{ name: string; size: number }> }>(
			plugin,
			"list",
			{ path: inside },
		);
		expect(entries.map((entry) => [entry.name, entry.size])).toEqual([
			["alias.dat", 4],
			["kept.dat", 4],
		]);
	});

	test("with no scope configured a link still reports its target's size", async () => {
		const { root, inside, outside } = await scratch();
		const secret = join(outside, "secret.dat");
		await writeFile(secret, "abc", "utf8");
		await symlink(secret, join(inside, "leak.dat"));
		const { entries } = await call<{ entries: Array<{ name: string; size: number }> }>(
			createFsPlugin({ root }),
			"list",
			{ path: inside },
		);
		expect(entries.map((entry) => entry.size)).toEqual([3]);
	});
});
