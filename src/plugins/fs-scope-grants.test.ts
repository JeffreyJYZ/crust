/**
 * The grant rule: `fs.scopeAllow` is a page command that appends a prefix and persists it, so leaving it
 * open made the boundary writable by the thing it bounds. It is refused unless the host opted in with
 * `grants: "page"`, and an app with no scope says so instead of pretending to have one.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createFsPlugin } from "@/plugins/fs";

type Plugin = ReturnType<typeof createFsPlugin>;

const roots: string[] = [];

async function scratch(): Promise<string> {
	const root = await realpath(await mkdtemp(join(tmpdir(), "crust-grants-")));
	roots.push(root);
	return root;
}

/** An allowed directory with one file, and a sibling outside it with another. */
async function tree(root: string) {
	const inside = join(root, "notes");
	const outside = join(root, "elsewhere");
	await mkdir(inside, { recursive: true });
	await mkdir(outside, { recursive: true });
	await writeFile(join(inside, "kept.md"), "kept", "utf8");
	await writeFile(join(outside, "secret.md"), "secret", "utf8");
	return { inside, outside };
}

async function call<T>(plugin: Plugin, name: string, args?: unknown): Promise<T> {
	const handler = (plugin.commands as Record<string, (input: unknown) => Promise<unknown>>)[name];
	if (handler === undefined) throw new Error(`no command ${name}`);
	return (await handler(args)) as T;
}

afterEach(async () => {
	for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

describe("fs scope grants", () => {
	test("a page may not widen its own scope: scopeAllow is refused by name", async () => {
		const root = await scratch();
		const { inside, outside } = await tree(root);
		for (const plugin of [
			createFsPlugin({ root }),
			createFsPlugin({ allow: [inside], root }),
		]) {
			for (const path of [inside, outside, "/"]) {
				await expect(call(plugin, "scopeAllow", { path })).rejects.toMatchObject({
					code: "outside-scope",
					message: expect.stringContaining("may not widen its own scope"),
				});
			}
		}
		// A refused grant changed nothing: the sibling is still outside the configured prefix.
		const scoped = createFsPlugin({ allow: [inside], root });
		await expect(call(scoped, "scopeAllow", { path: outside })).rejects.toBeDefined();
		await expect(
			call(scoped, "readTextFile", { path: join(outside, "secret.md") }),
		).rejects.toMatchObject({ code: "outside-scope" });
	});

	test("the refusal comes before the argument, so a malformed call names the real reason", async () => {
		const root = await scratch();
		const plugin = createFsPlugin({ allow: [], root });
		for (const args of [{ path: "notes" }, { path: "" }, undefined, { path: 7 }]) {
			await expect(call(plugin, "scopeAllow", args)).rejects.toMatchObject({
				code: "outside-scope",
				message: expect.stringContaining('grants is "runtime"'),
			});
		}
	});

	test("the host opts in with grants: page, and only then is the command reachable", async () => {
		const root = await scratch();
		const { inside } = await tree(root);
		const plugin = createFsPlugin({ allow: [], root, grants: "page" });
		expect(
			await call<{ ok: true; paths: string[] }>(plugin, "scopeAllow", { path: inside }),
		).toEqual({ ok: true, paths: [inside] });
		expect(await call<string>(plugin, "readTextFile", { path: join(inside, "kept.md") })).toBe(
			"kept",
		);
	});

	test("scopeRevoke stays reachable, because it can only take a grant away", async () => {
		const root = await scratch();
		const { inside } = await tree(root);
		const plugin = createFsPlugin({ allow: [inside], root });
		expect(
			await call<{ ok: true; paths: string[] }>(plugin, "scopeRevoke", { path: inside }),
		).toEqual({ ok: true, paths: [inside] });
		expect(await call<string>(plugin, "readTextFile", { path: join(inside, "kept.md") })).toBe(
			"kept",
		);
	});

	test("an app with no scope still reads a file and reports scoped: false", async () => {
		const root = await scratch();
		const { outside } = await tree(root);
		const plugin = createFsPlugin({ root });
		expect(
			await call<string>(plugin, "readTextFile", { path: join(outside, "secret.md") }),
		).toBe("secret");
		const status = await call<{ ok: true; paths: string[]; scoped: boolean; reason?: string }>(
			plugin,
			"scopeList",
		);
		expect(status).toMatchObject({ ok: true, paths: [], scoped: false });
		expect(status.reason).toContain("every file this user can");
	});

	test("a configured scope reports scoped: true and carries no reason", async () => {
		const root = await scratch();
		const { inside } = await tree(root);
		const plugin = createFsPlugin({ allow: [inside], root });
		expect(await call(plugin, "scopeList")).toEqual({
			ok: true,
			paths: [inside],
			scoped: true,
		});
	});
});
