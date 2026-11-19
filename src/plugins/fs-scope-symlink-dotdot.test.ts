/**
 * A `..` after a symlink is resolved by the OS **through** the link, but a lexical fold erases the link
 * before `realpath` sees it. That is the escape: the scope check names an in-scope path while the command
 * reads or writes a file outside the grant. These cases drive the real plugin against a real temp tree.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";

import { createFsPlugin } from "@/plugins/fs";

type Plugin = ReturnType<typeof createFsPlugin>;

const roots: string[] = [];

async function scratch(): Promise<{ root: string; inside: string; outside: string }> {
	const root = await realpath(await mkdtemp(join(tmpdir(), "crust-dotdot-")));
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

describe("a .. walk through a symlink", () => {
	test("a read of scope/link/../secret.txt is refused, not served from outside", async () => {
		const { root, inside, outside } = await scratch();
		await writeFile(join(root, "secret.txt"), "secret", "utf8");
		await symlink(outside, join(inside, "link"));
		const plugin = createFsPlugin({ allow: [inside], root });
		// join() folds link/.. itself, so build the raw string a page would send.
		const raw = `${inside}${sep}link${sep}..${sep}secret.txt`;
		await expect(call<string>(plugin, "readTextFile", { path: raw })).rejects.toMatchObject({
			code: "outside-scope",
		});
	});

	test("a write of scope/link/../planted.txt cannot plant a file outside the scope", async () => {
		const { root, inside, outside } = await scratch();
		await symlink(outside, join(inside, "link"));
		const plugin = createFsPlugin({ allow: [inside], root });
		const raw = `${inside}${sep}link${sep}..${sep}planted.txt`;
		await expect(
			call(plugin, "writeTextFile", { path: raw, contents: "PWNED" }),
		).rejects.toMatchObject({ code: "outside-scope" });
		await expect(Bun.file(join(root, "planted.txt")).exists()).resolves.toBe(false);
	});
});
