/**
 * `ATTACH` containment. SQLite opens files named by SQL, so the name rule has to reach the
 * attachment too: an absolute path, a literal path and a symlink must not create or read a file
 * outside the data root. A companion named inside the root still attaches.
 */

import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createDatabasePlugin } from "@/plugins/database";

const scratch = async (): Promise<string> => await mkdtemp(join(tmpdir(), "crust-attach-"));

type Plugin = ReturnType<typeof createDatabasePlugin>;

async function call<T>(plugin: Plugin, name: string, args?: unknown): Promise<T> {
	const handler = (plugin.commands as unknown as Record<string, (input?: unknown) => unknown>)[
		name
	];
	if (handler === undefined) throw new Error(`no command ${name}`);
	return (await handler(args)) as T;
}

async function opened(plugin: Plugin, readonly = false): Promise<string> {
	const answer = await call<{ ok: boolean; handle?: string; message?: string }>(plugin, "open", {
		name: "main",
		readonly,
	});
	if (answer.ok !== true || answer.handle === undefined) {
		throw new Error(`open refused: ${answer.message}`);
	}
	return answer.handle;
}

/** An outside database with one row, so a read escape answers with bytes, not an empty table. */
function seed(file: string): void {
	const db = new Database(file, { create: true });
	db.exec("CREATE TABLE secret (value TEXT); INSERT INTO secret VALUES ('OUTSIDE')");
	db.close();
}

describe("ATTACH cannot open a file outside the data root", () => {
	test("a bound absolute path neither creates nor reads an outside database", async () => {
		const root = await scratch();
		const outside = await scratch();
		try {
			seed(join(outside, "existing.sqlite"));
			const plugin = createDatabasePlugin({ root });
			const handle = await opened(plugin);
			const target = join(outside, "attached.sqlite");
			const refused = await call<{ ok: boolean; code?: string }>(plugin, "exec", {
				handle,
				sql: "ATTACH DATABASE ? AS escaped",
				args: [target],
			});
			expect(refused).toMatchObject({ ok: false, code: "sql-error" });
			// The read attempt is the escape: a row would prove the attached file was opened.
			expect(
				await call<{ ok: boolean; rows?: unknown[] }>(plugin, "query", {
					handle,
					sql: "SELECT value FROM escaped.secret",
				}),
			).toMatchObject({ ok: false });
			expect(await Bun.file(target).exists()).toBe(false);
		} finally {
			await rm(root, { recursive: true, force: true });
			await rm(outside, { recursive: true, force: true });
		}
	});

	test("a literal absolute path is refused the same way", async () => {
		const root = await scratch();
		const outside = await scratch();
		try {
			const plugin = createDatabasePlugin({ root });
			const handle = await opened(plugin);
			const target = join(outside, "literal.sqlite");
			expect(
				await call<{ ok: boolean }>(plugin, "exec", {
					handle,
					sql: `ATTACH DATABASE '${target}' AS escaped`,
				}),
			).toMatchObject({ ok: false });
			expect(await Bun.file(target).exists()).toBe(false);
		} finally {
			await rm(root, { recursive: true, force: true });
			await rm(outside, { recursive: true, force: true });
		}
	});

	test("a symlink inside the root cannot name an outside attachment", async () => {
		const root = await scratch();
		const outside = await scratch();
		try {
			seed(join(outside, "existing.sqlite"));
			await symlink(join(outside, "existing.sqlite"), join(root, "linked.sqlite"));
			const plugin = createDatabasePlugin({ root });
			const handle = await opened(plugin);
			expect(
				await call<{ ok: boolean }>(plugin, "exec", {
					handle,
					sql: "ATTACH DATABASE ? AS escaped",
					args: ["linked"],
				}),
			).toMatchObject({ ok: false });
			expect(
				await call<{ ok: boolean }>(plugin, "query", {
					handle,
					sql: "SELECT value FROM escaped.secret",
				}),
			).toMatchObject({ ok: false });
		} finally {
			await rm(root, { recursive: true, force: true });
			await rm(outside, { recursive: true, force: true });
		}
	});

	test("VACUUM INTO cannot write a database to an outside path", async () => {
		const root = await scratch();
		const outside = await scratch();
		try {
			const plugin = createDatabasePlugin({ root });
			const handle = await opened(plugin);
			const target = join(outside, "vacuum.sqlite");
			expect(
				await call<{ ok: boolean }>(plugin, "exec", {
					handle,
					sql: "VACUUM INTO ?",
					args: [target],
				}),
			).toMatchObject({ ok: false });
			expect(await Bun.file(target).exists()).toBe(false);
		} finally {
			await rm(root, { recursive: true, force: true });
			await rm(outside, { recursive: true, force: true });
		}
	});
});
