/**
 * `crust:database`'s containment rule: a name is a name, never a path, and a symlink already sitting
 * in the data directory cannot carry the open outside it. Nothing here leaves the temp directories.
 */

import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createDatabasePlugin, databaseFile } from "@/plugins/database";

const scratch = async (): Promise<string> => await mkdtemp(join(tmpdir(), "crust-database-scope-"));

type Plugin = ReturnType<typeof createDatabasePlugin>;

async function call(plugin: Plugin, name: string, args?: unknown): Promise<unknown> {
	const table = plugin.commands as unknown as Record<string, (input?: unknown) => unknown>;
	const handler = table[name];
	if (handler === undefined) throw new Error(`no command ${name}`);
	return await handler(args);
}

describe("a name is not a path", () => {
	test("every escaping or malformed name is refused by name", async () => {
		const root = await scratch();
		try {
			const plugin = createDatabasePlugin({ root });
			for (const name of ["../escape", "/etc/passwd", "a/b", "a\\b", "..", ".", "", "  "]) {
				// A name refusal is the structured `bad-request` the bridge serialises, never a value
				// a page could read as "no database"; the message names what is wrong with the name.
				await expect(call(plugin, "open", { name })).rejects.toMatchObject({
					code: "bad-request",
				});
			}
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	test("a symlink inside the root cannot carry the open outside it", async () => {
		const root = await scratch();
		const outside = await scratch();
		try {
			await symlink(outside, join(root, "linked.sqlite"));
			const plugin = createDatabasePlugin({ root });
			// The canonical check refuses the resolved target before SQLite sees the path.
			await expect(call(plugin, "open", { name: "linked" })).rejects.toMatchObject({
				code: "bad-request",
			});
		} finally {
			await rm(root, { recursive: true, force: true });
			await rm(outside, { recursive: true, force: true });
		}
	});

	test("a plain name resolves inside the root and gains the suffix only once", () => {
		expect(databaseFile("notes", { root: "/data/app" })).toBe(
			join("/data/app", "notes.sqlite"),
		);
		expect(databaseFile("notes.sqlite", { root: "/data/app" })).toBe(
			join("/data/app", "notes.sqlite"),
		);
	});
});
