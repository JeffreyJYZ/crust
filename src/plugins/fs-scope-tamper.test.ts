/**
 * The store's own reachability. `scope.json` lives in the app's data directory, which is exactly where a
 * page may write, so a page could grant itself any prefix by writing the file the plugin reads on the next
 * launch. Every test here attacks that from the plugin's own command table: the store is the plugin's state,
 * not app data, so no page command may touch it — while a grant the host made still survives a restart.
 *
 * The attack needs the data root inside the configured scope, which is the ordinary app shape: an app
 * allows its own data directory so it can keep files, and the store sits in that same directory.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createFsPlugin } from "@/plugins/fs";
import { createFsScope, SCOPE_FILE } from "@/plugins/fs-scope";

type Plugin = ReturnType<typeof createFsPlugin>;

const roots: string[] = [];

async function scratch(): Promise<string> {
	const root = await realpath(await mkdtemp(join(tmpdir(), "crust-tamper-")));
	roots.push(root);
	return root;
}

/** The app's data root (inside the scope), and a directory outside it with a secret in it. */
async function tree() {
	const root = await scratch();
	const data = join(root, "data");
	const elsewhere = await scratch();
	const outside = join(elsewhere, "elsewhere");
	await mkdir(data, { recursive: true });
	await mkdir(outside, { recursive: true });
	await writeFile(join(data, "kept.md"), "kept", "utf8");
	await writeFile(join(outside, "secret.md"), "secret", "utf8");
	return { root, data, outside };
}

async function call<T>(plugin: Plugin, name: string, args?: unknown): Promise<T> {
	const handler = (plugin.commands as Record<string, (input: unknown) => Promise<unknown>>)[name];
	if (handler === undefined) throw new Error(`no command ${name}`);
	return (await handler(args)) as T;
}

afterEach(async () => {
	for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

describe("fs scope store is not the page's to write", () => {
	test("the write route is closed: a page cannot plant a grant for the next launch", async () => {
		const { root, outside } = await tree();
		// The app allows its own data root, which is where `scope.json` lives.
		const plugin = createFsPlugin({ allow: [root], root });
		await expect(
			call(plugin, "writeTextFile", {
				path: join(root, SCOPE_FILE),
				contents: JSON.stringify([outside]),
			}),
		).rejects.toMatchObject({
			code: "outside-scope",
			message: expect.stringContaining("scope store"),
		});

		// Nothing landed, so the next launch has no grant to honour.
		const restarted = createFsPlugin({ allow: [root], root });
		await expect(
			call(restarted, "readTextFile", { path: join(outside, "secret.md") }),
		).rejects.toMatchObject({ code: "outside-scope" });
	});

	test("an unscoped app refuses the store too, because the boundary is absent, not open", async () => {
		const { root, outside } = await tree();
		const plugin = createFsPlugin({ root });
		await expect(
			call(plugin, "writeTextFile", {
				path: join(root, SCOPE_FILE),
				contents: JSON.stringify([outside]),
			}),
		).rejects.toMatchObject({ code: "outside-scope" });
		await expect(
			call(plugin, "readTextFile", { path: join(root, SCOPE_FILE) }),
		).rejects.toMatchObject({ code: "outside-scope" });
	});

	test("the store is unwritable through every command that takes a path", async () => {
		const { root, data } = await tree();
		const plugin = createFsPlugin({ allow: [root], root });
		const store = join(root, SCOPE_FILE);
		for (const [command, args] of [
			["writeTextFile", { path: store, contents: "[]" }],
			["readTextFile", { path: store }],
			["remove", { path: store }],
			["rename", { from: store, to: join(data, "stolen.json") }],
			["rename", { from: join(data, "kept.md"), to: store }],
		] as const) {
			await expect(call(plugin, command, args)).rejects.toMatchObject({
				code: "outside-scope",
			});
		}
		// A rename cannot smuggle the file out under a name the plugin still reads either.
		await expect(
			call(plugin, "rename", {
				from: join(root, "data", "kept.md"),
				to: join(root, SCOPE_FILE),
			}),
		).rejects.toMatchObject({ code: "outside-scope" });
	});

	test.skipIf(process.platform === "linux")(
		"a case variant of the store name is the same file, so it is refused too",
		async () => {
			const { root, outside } = await tree();
			const plugin = createFsPlugin({ allow: [root], root });
			// APFS and NTFS compare names case-insensitively; on linux `SCOPE.json` is a second file.
			await expect(
				call(plugin, "writeTextFile", {
					path: join(root, "SCOPE.json"),
					contents: JSON.stringify([outside]),
				}),
			).rejects.toMatchObject({ code: "outside-scope" });
		},
	);

	test("a grant the host made still persists across a restart", async () => {
		const { root, data } = await tree();
		// The host path: no page command involved, the way a config or a consent sheet would grant it.
		await createFsScope({ allow: [], root }).allow({ path: data });
		expect(JSON.parse(await readFile(join(root, SCOPE_FILE), "utf8"))).toEqual([data]);

		const plugin = createFsPlugin({ allow: [], root });
		expect(await call<string>(plugin, "readTextFile", { path: join(data, "kept.md") })).toBe(
			"kept",
		);
		expect(
			await call<{ ok: true; paths: string[]; scoped: boolean }>(plugin, "scopeList"),
		).toEqual({
			ok: true,
			paths: [data],
			scoped: true,
		});
	});
});
