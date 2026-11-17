/**
 * `crust:database` against a temp root: the round trip, bound parameters, the read-only open and the
 * typed `sql-error`. The name rule that keeps a name from being a path lives in
 * `database-scope.test.ts`. Nothing here leaves the temp directory.
 */

import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	createDatabasePlugin,
	type CloseResult,
	type ExecResult,
	type GetResult,
	type OpenResult,
	type QueryResult,
	type SqlFailure,
} from "@/plugins/database";

const scratch = async (): Promise<string> => await mkdtemp(join(tmpdir(), "crust-database-"));

type Plugin = ReturnType<typeof createDatabasePlugin>;

async function call<T>(plugin: Plugin, name: string, args?: unknown): Promise<T> {
	const table = plugin.commands as unknown as Record<string, (input?: unknown) => unknown>;
	const handler = table[name];
	if (handler === undefined) throw new Error(`no command ${name}`);
	return (await handler(args)) as T;
}

/** A plugin over a fresh scratch root, plus its cleanup. */
async function withPlugin(run: (plugin: Plugin, root: string) => Promise<void>): Promise<void> {
	const root = await scratch();
	try {
		await run(createDatabasePlugin({ root }), root);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
}

/** Open a handle and return it; fails the test rather than the caller if the open refused. */
async function opened(plugin: Plugin, name = "notes"): Promise<string> {
	const result = await call<OpenResult | SqlFailure>(plugin, "open", { name });
	if (result.ok !== true) throw new Error(`open refused: ${result.message}`);
	return result.handle;
}

describe("database round trip", () => {
	test("open, exec, query, get and close over a named file", async () => {
		await withPlugin(async (plugin, root) => {
			const handle = await opened(plugin);
			expect(
				await call<ExecResult>(plugin, "exec", {
					handle,
					sql: "CREATE TABLE note (id INTEGER PRIMARY KEY, body TEXT, n INTEGER)",
				}),
			).toMatchObject({ ok: true });

			const insert = await call<ExecResult>(plugin, "exec", {
				handle,
				sql: "INSERT INTO note (body, n) VALUES (?, ?)",
				args: ["hello", 7],
			});
			expect(insert).toMatchObject({ ok: true, changes: 1, lastInsertRowid: 1 });

			expect(
				await call<QueryResult>(plugin, "query", {
					handle,
					sql: "SELECT body, n FROM note ORDER BY id",
				}),
			).toEqual({ ok: true, rows: [{ body: "hello", n: 7 }] });

			expect(
				await call<GetResult>(plugin, "get", {
					handle,
					sql: "SELECT body FROM note WHERE n = ?",
					args: [7],
				}),
			).toEqual({ ok: true, row: { body: "hello" } });

			// Nothing matched is `row: null`, which is an answer, not a failure.
			expect(
				await call<GetResult>(plugin, "get", {
					handle,
					sql: "SELECT body FROM note WHERE n = ?",
					args: [999],
				}),
			).toEqual({ ok: true, row: null });

			expect(await call<CloseResult>(plugin, "close", { handle })).toEqual({
				ok: true,
				handle,
			});
			// The file is the name plus the suffix, under the injected root.
			expect(await Bun.file(join(root, "notes.sqlite")).exists()).toBe(true);
		});
	});

	test("a closed handle answers unknown-handle and a second close stays typed", async () => {
		await withPlugin(async (plugin) => {
			const handle = await opened(plugin);
			await call<CloseResult>(plugin, "close", { handle });
			expect(
				await call<SqlFailure>(plugin, "query", { handle, sql: "SELECT 1" }),
			).toMatchObject({ ok: false, code: "unknown-handle" });
			expect(await call<SqlFailure>(plugin, "close", { handle })).toMatchObject({
				ok: false,
				code: "unknown-handle",
			});
			expect(
				await call<SqlFailure>(plugin, "exec", { handle: "db-999", sql: "SELECT 1" }),
			).toMatchObject({ ok: false, code: "unknown-handle" });
		});
	});
});

describe("bound parameters", () => {
	test("a value is bound, never interpolated, so a quote is data", async () => {
		await withPlugin(async (plugin) => {
			const handle = await opened(plugin);
			await call<ExecResult>(plugin, "exec", { handle, sql: "CREATE TABLE t (v TEXT)" });
			const payload = "'); DROP TABLE t; --";
			expect(
				await call<ExecResult>(plugin, "exec", {
					handle,
					sql: "INSERT INTO t (v) VALUES (?)",
					args: [payload],
				}),
			).toMatchObject({ ok: true });
			expect(
				await call<QueryResult>(plugin, "query", { handle, sql: "SELECT v FROM t" }),
			).toEqual({ ok: true, rows: [{ v: payload }] });
		});
	});
});

describe("sql errors", () => {
	test("a broken statement answers a typed sql-error carrying SQLite's message", async () => {
		await withPlugin(async (plugin) => {
			const handle = await opened(plugin);
			for (const command of ["exec", "query", "get"] as const) {
				const result = await call<SqlFailure>(plugin, command, {
					handle,
					sql: "SELECT * FROM no_such_table",
				});
				expect(result.ok).toBe(false);
				expect(result.code).toBe("sql-error");
				expect(result.message).toContain("no_such_table");
			}
		});
	});

	test("a malformed payload answers sql-error rather than throwing", async () => {
		await withPlugin(async (plugin) => {
			const handle = await opened(plugin);
			expect(await call<SqlFailure>(plugin, "query", { handle, sql: "  " })).toMatchObject({
				ok: false,
				code: "sql-error",
			});
			expect(
				await call<SqlFailure>(plugin, "query", { handle, sql: "SELECT 1", args: "nope" }),
			).toMatchObject({ ok: false, code: "sql-error" });
		});
	});
});

describe("readonly is a real open", () => {
	test("a write on a readonly handle is refused by SQLite itself", async () => {
		await withPlugin(async (plugin, root) => {
			const writable = await opened(plugin);
			await call<ExecResult>(plugin, "exec", {
				handle: writable,
				sql: "CREATE TABLE t (v INTEGER)",
			});
			await call<CloseResult>(plugin, "close", { handle: writable });

			const again = await call<OpenResult | SqlFailure>(plugin, "open", {
				name: "notes",
				readonly: true,
			});
			if (again.ok !== true) throw new Error(`readonly open refused: ${again.message}`);
			expect(again).toMatchObject({
				ok: true,
				readonly: true,
				path: join(root, "notes.sqlite"),
			});
			expect(
				await call<SqlFailure>(plugin, "exec", {
					handle: again.handle,
					sql: "INSERT INTO t (v) VALUES (1)",
				}),
			).toMatchObject({ ok: false, code: "sql-error" });
		});
	});
});
