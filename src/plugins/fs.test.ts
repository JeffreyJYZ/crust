import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { fsPlugin } from "@/plugins/fs";

/** Call one command the way the bridge does, through the plugin's own table. */
async function call<T>(name: string, args: unknown): Promise<T> {
	const handler = (fsPlugin.commands as Record<string, (input: unknown) => Promise<unknown>>)[
		name
	];
	if (handler === undefined) throw new Error(`no command ${name}`);
	return (await handler(args)) as T;
}

async function scratch(): Promise<string> {
	return await mkdtemp(join(tmpdir(), "crust-fs-"));
}

describe("fs.list", () => {
	test("lists names, absolute paths, directories and sizes, sorted", async () => {
		const dir = await scratch();
		try {
			await writeFile(join(dir, "b.md"), "hello", "utf8");
			await writeFile(join(dir, "a.md"), "hi", "utf8");
			const { entries } = await call<{
				entries: Array<{ name: string; path: string; directory: boolean; size: number }>;
			}>("list", { path: dir });
			expect(entries.map((entry) => entry.name)).toEqual(["a.md", "b.md"]);
			expect(entries[0]?.path).toBe(join(dir, "a.md"));
			expect(entries[0]?.size).toBe(2);
			expect(entries.every((entry) => entry.directory === false)).toBe(true);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test("a missing directory is not-found, not a bare throw", async () => {
		const dir = await scratch();
		try {
			await expect(call("list", { path: join(dir, "nope") })).rejects.toMatchObject({
				code: "not-found",
			});
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});
});

describe("fs.stat", () => {
	test("reports directory, size and modification time", async () => {
		const dir = await scratch();
		try {
			const file = join(dir, "note.md");
			await writeFile(file, "four", "utf8");
			const info = await call<{
				directory: boolean;
				size: number;
				modified: number;
				path: string;
			}>("stat", { path: file });
			expect(info).toMatchObject({ directory: false, size: 4, path: file });
			expect(info.modified).toBeGreaterThan(0);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test("a missing path is not-found", async () => {
		const dir = await scratch();
		try {
			await expect(call("stat", { path: join(dir, "gone.md") })).rejects.toMatchObject({
				code: "not-found",
			});
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});
});

describe("fs.remove", () => {
	test("removes a file", async () => {
		const dir = await scratch();
		try {
			const file = join(dir, "scrap.md");
			await writeFile(file, "x", "utf8");
			expect(
				await call<{ removed: boolean; path: string }>("remove", { path: file }),
			).toEqual({
				removed: true,
				path: file,
			});
			await expect(call("stat", { path: file })).rejects.toMatchObject({ code: "not-found" });
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test("removes a non-empty directory only when told to recurse", async () => {
		const dir = await scratch();
		try {
			const nested = join(dir, "notes");
			await writeFile(join(dir, "notes-keep.md"), "x", "utf8");
			await Bun.write(join(nested, "a.md"), "x");
			await expect(call("remove", { path: nested })).rejects.toBeDefined();
			await call("remove", { path: nested, recursive: true });
			await expect(call("stat", { path: nested })).rejects.toMatchObject({
				code: "not-found",
			});
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});
});

describe("fs.rename", () => {
	test("moves a file and reports the new absolute path", async () => {
		const dir = await scratch();
		try {
			const from = join(dir, "draft.md");
			const to = join(dir, "final.md");
			await writeFile(from, "text", "utf8");
			expect(await call<{ path: string }>("rename", { from, to })).toEqual({ path: to });
			expect(await Bun.file(to).text()).toBe("text");
			await expect(call("stat", { path: from })).rejects.toMatchObject({ code: "not-found" });
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test("a missing source is not-found", async () => {
		const dir = await scratch();
		try {
			await expect(
				call("rename", { from: join(dir, "nope.md"), to: join(dir, "x.md") }),
			).rejects.toMatchObject({ code: "not-found" });
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});
});

describe("fs argument rules", () => {
	test("a non-string or empty path is bad-request for every command", async () => {
		for (const command of ["list", "stat", "remove"]) {
			await expect(call(command, { path: "" })).rejects.toMatchObject({
				code: "bad-request",
			});
			await expect(call(command, { path: 7 })).rejects.toMatchObject({ code: "bad-request" });
		}
		await expect(call("rename", { from: "", to: "x" })).rejects.toMatchObject({
			code: "bad-request",
		});
	});
});
