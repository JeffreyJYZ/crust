import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ConfigError, validateConfig } from "@/config";
import { createFsPlugin } from "@/plugins/fs";
import { SCOPE_FILE } from "@/plugins/fs-scope";

type Plugin = ReturnType<typeof createFsPlugin>;

const roots: string[] = [];

/** A scratch root, cleaned up by `afterEach` so no test leaks a temp tree. */
async function scratch(): Promise<string> {
	const root = await realpath(await mkdtemp(join(tmpdir(), "crust-scope-")));
	roots.push(root);
	return root;
}

/** An allowed directory, a sibling outside it, and one file in each. */
async function tree(root: string) {
	const inside = join(root, "notes");
	const outside = join(root, "elsewhere");
	await mkdir(inside, { recursive: true });
	await mkdir(outside, { recursive: true });
	await writeFile(join(inside, "kept.md"), "kept", "utf8");
	await writeFile(join(outside, "secret.md"), "secret", "utf8");
	return { inside, outside };
}

/** Call one command the way the bridge does, through the plugin's own table. */
async function call<T>(plugin: Plugin, name: string, args?: unknown): Promise<T> {
	const handler = (plugin.commands as Record<string, (input: unknown) => Promise<unknown>>)[name];
	if (handler === undefined) throw new Error(`no command ${name}`);
	return (await handler(args)) as T;
}

afterEach(async () => {
	for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

describe("fs scope", () => {
	test("with no scope configured every path still works, exactly as before", async () => {
		const root = await scratch();
		const { outside } = await tree(root);
		const plugin = createFsPlugin({ root });
		expect(
			await call<string>(plugin, "readTextFile", {
				path: join(outside, "secret.md"),
			}),
		).toBe("secret");
		await call(plugin, "writeTextFile", {
			path: join(root, "loose.md"),
			contents: "x",
		});
		const status = await call<{ ok: true; paths: string[]; scoped: boolean; reason?: string }>(
			plugin,
			"scopeList",
		);
		expect(status.paths).toEqual([]);
		expect(status.scoped).toBe(false);
		expect(status.reason).toContain("fs.scope");
	});

	test("a path inside a configured prefix is allowed", async () => {
		const root = await scratch();
		const { inside } = await tree(root);
		const plugin = createFsPlugin({ allow: [inside], root });
		expect(
			await call<string>(plugin, "readTextFile", {
				path: join(inside, "kept.md"),
			}),
		).toBe("kept");
		const { entries } = await call<{ entries: Array<{ name: string }> }>(plugin, "list", {
			path: inside,
		});
		expect(entries.map((entry) => entry.name)).toEqual(["kept.md"]);
		expect((await call<{ scoped: boolean }>(plugin, "scopeList")).scoped).toBe(true);
	});

	test("a path outside every prefix is outside-scope and names the path", async () => {
		const root = await scratch();
		const { inside, outside } = await tree(root);
		const sibling = join(root, "notes-2");
		await mkdir(sibling);
		const plugin = createFsPlugin({ allow: [inside], root });
		for (const path of [join(outside, "secret.md"), sibling]) {
			await expect(call(plugin, "list", { path })).rejects.toMatchObject({
				code: "outside-scope",
				message: expect.stringContaining(path),
			});
		}
	});

	test("a .. walk out of a prefix is refused, and so is a rename into one", async () => {
		const root = await scratch();
		const { inside, outside } = await tree(root);
		const plugin = createFsPlugin({ allow: [inside], root });
		await expect(
			call(plugin, "readTextFile", {
				path: join(inside, "..", "elsewhere", "secret.md"),
			}),
		).rejects.toMatchObject({ code: "outside-scope" });
		await expect(
			call(plugin, "rename", {
				from: join(inside, "kept.md"),
				to: join(outside, "stolen.md"),
			}),
		).rejects.toMatchObject({ code: "outside-scope" });
		expect(
			await call<string>(plugin, "readTextFile", {
				path: join(inside, "kept.md"),
			}),
		).toBe("kept");
	});

	test("a host grant persists to scope.json, survives a new instance, and is 0600", async () => {
		const root = await scratch();
		const { inside } = await tree(root);
		const first = createFsPlugin({ allow: [], root, grants: "page" });
		await expect(
			call(first, "readTextFile", { path: join(inside, "kept.md") }),
		).rejects.toMatchObject({ code: "outside-scope" });
		expect(
			await call<{ ok: true; paths: string[] }>(first, "scopeAllow", {
				path: inside,
			}),
		).toEqual({ ok: true, paths: [inside] });
		expect((await stat(join(root, SCOPE_FILE))).mode & 0o777).toBe(0o600);

		const second = createFsPlugin({ allow: [], root });
		expect(
			await call<string>(second, "readTextFile", {
				path: join(inside, "kept.md"),
			}),
		).toBe("kept");
		expect(await call<{ ok: true; paths: string[] }>(second, "scopeList")).toMatchObject({
			ok: true,
			paths: [inside],
			scoped: true,
		});
	});

	test("revoke takes the grant back, and a relative grant is bad-request", async () => {
		const root = await scratch();
		const { inside } = await tree(root);
		const plugin = createFsPlugin({ allow: [], root, grants: "page" });
		await call(plugin, "scopeAllow", { path: inside });
		await expect(call(plugin, "scopeAllow", { path: "notes" })).rejects.toMatchObject({
			code: "bad-request",
		});
		expect(await call(plugin, "scopeRevoke", { path: inside })).toEqual({
			ok: true,
			paths: [],
		});
		await expect(
			call(plugin, "readTextFile", { path: join(inside, "kept.md") }),
		).rejects.toMatchObject({ code: "outside-scope" });
		const restarted = createFsPlugin({ allow: [], root });
		await expect(
			call(restarted, "readTextFile", { path: join(inside, "kept.md") }),
		).rejects.toMatchObject({ code: "outside-scope" });
	});
});

describe("fs config", () => {
	const base = {
		app: { id: "dev.crust.fs", name: "Fs", version: "0.0.0" },
		windows: [{ label: "main" }],
	};

	test("accepts absolute prefixes and an empty section", () => {
		expect(validateConfig({ ...base, fs: { scope: ["/tmp", "/Users/me"] } }).fs).toEqual({
			scope: ["/tmp", "/Users/me"],
		});
		expect(validateConfig({ ...base, fs: {} }).fs).toEqual({});
	});

	test("refuses a relative, empty or non-string entry, and an unknown key", () => {
		for (const scope of [["./notes"], [""], [7], "notes"]) {
			expect(() => validateConfig({ ...base, fs: { scope } })).toThrow(/fs\.scope/);
		}
		expect(() => validateConfig({ ...base, fs: { scope: ["/tmp"], nope: 1 } })).toThrow(
			ConfigError,
		);
	});
});
