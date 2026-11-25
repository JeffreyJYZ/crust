/**
 * The containment fix must leave legitimate attachments working: a companion named inside the data
 * root still attaches and reads, and a read-only main handle still refuses a second file.
 */

import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createDatabasePlugin } from "@/plugins/database";

const scratch = async (): Promise<string> => await mkdtemp(join(tmpdir(), "crust-attach-ok-"));

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

describe("an attachment the root allows still works", () => {
	test("a companion named inside the root attaches and reads", async () => {
		const root = await scratch();
		try {
			const plugin = createDatabasePlugin({ root });
			const handle = await opened(plugin);
			expect(
				await call(plugin, "exec", {
					handle,
					sql: "ATTACH DATABASE ? AS side",
					args: ["companion"],
				}),
			).toMatchObject({ ok: true });
			expect(
				await call(plugin, "exec", {
					handle,
					sql: "CREATE TABLE side.extra (value TEXT)",
				}),
			).toMatchObject({ ok: true });
			expect(
				await call(plugin, "exec", {
					handle,
					sql: "INSERT INTO side.extra VALUES ('INSIDE')",
				}),
			).toMatchObject({ ok: true });
			expect(
				await call<{ ok: boolean; rows: Array<{ value: string }> }>(plugin, "query", {
					handle,
					sql: "SELECT value FROM side.extra",
				}),
			).toEqual({ ok: true, rows: [{ value: "INSIDE" }] });
			expect(await Bun.file(join(root, "companion.sqlite")).exists()).toBe(true);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	test("a readonly handle cannot attach even an in-root name", async () => {
		const root = await scratch();
		try {
			const writable = createDatabasePlugin({ root });
			const first = await opened(writable);
			await call(writable, "exec", {
				handle: first,
				sql: "ATTACH DATABASE ? AS side",
				args: ["companion"],
			});
			await call(writable, "close", { handle: first });
			const readonly = createDatabasePlugin({ root });
			const handle = await opened(readonly, true);
			expect(
				await call(readonly, "exec", {
					handle,
					sql: "ATTACH DATABASE ? AS extra",
					args: ["companion"],
				}),
			).toMatchObject({ ok: false });
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});
