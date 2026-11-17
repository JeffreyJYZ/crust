/**
 * `crust:database` — a page-facing SQLite surface: open a named database, run SQL, read rows, close.
 *
 * `bun:sqlite` underneath, and the name rule lives in `database-name.ts` so a name can never be a
 * path. `readonly: true` opens the file read-only at the SQLite level, so a write fails in the
 * engine rather than depending on the plugin to refuse it.
 *
 * A statement that throws answers `{ ok: false, code: "sql-error", message }` carrying SQLite's own
 * message: a page branches on `ok`, and a rejected invoke with a stack tells it nothing. Arguments
 * are bound parameters — `args` is an array handed to `stmt.run(...)` / `.all(...)`; nothing is
 * ever interpolated into SQL, and a name, a number and a string all stay data.
 */

import { Database } from "bun:sqlite";

import { definePlugin, type PluginDefinition } from "./define";
import { isFailure, readSql, sqlFailure, unknownHandle } from "./database-args.ts";
import { ensureDatabaseFile, type DatabasePathOptions } from "./database-name.ts";
import type {
	CloseResult,
	ExecResult,
	GetResult,
	OpenArgs,
	OpenResult,
	QueryResult,
	SqlArgs,
	SqlFailure,
	SqlRow,
} from "./database-types.ts";

export type { DatabasePathOptions } from "./database-name.ts";
export {
	databaseFile,
	databaseRoot,
	ensureDatabaseFile,
	DATABASE_SUFFIX,
} from "./database-name.ts";
export type {
	CloseResult,
	ExecResult,
	GetResult,
	OpenArgs,
	OpenResult,
	QueryResult,
	SqlArgs,
	SqlFailure,
	SqlOutcome,
	SqlRow,
} from "./database-types.ts";

export { isFailure, readSql, sqlFailure, unknownHandle } from "./database-args.ts";

export type DatabaseCommands = {
	open: (args: OpenArgs) => Promise<OpenResult | SqlFailure>;
	close: (args: { handle: string }) => CloseResult | SqlFailure;
	exec: (args: SqlArgs) => Promise<ExecResult | SqlFailure>;
	query: (args: SqlArgs) => Promise<QueryResult | SqlFailure>;
	get: (args: SqlArgs) => Promise<GetResult | SqlFailure>;
};

/**
 * The plugin. Handles are `db-<n>`, unique per plugin instance, and the map is the only thing a
 * page can name, so a handle from another app's process is not addressable.
 */
export function createDatabasePlugin(
	options: DatabasePathOptions = {},
): PluginDefinition<"database", DatabaseCommands> {
	const open = new Map<string, Database>();
	let next = 0;

	const handleOf = (db: Database): string => {
		const handle = `db-${++next}`;
		open.set(handle, db);
		return handle;
	};

	/** A handle's database, or the typed refusal — never a throw for a stale handle. */
	const find = (handle: unknown): Database | SqlFailure => {
		if (typeof handle !== "string" || handle === "") {
			return unknownHandle(String(handle));
		}
		const db = open.get(handle);
		return db ?? unknownHandle(handle);
	};

	return definePlugin({
		name: "database",
		commands: {
			open: async ({ name, readonly }: OpenArgs): Promise<OpenResult | SqlFailure> => {
				const file = await ensureDatabaseFile(name, options);
				try {
					// A real read-only open: SQLite refuses a write on the file handle itself.
					const db = new Database(
						file,
						readonly === true ? { readonly: true } : { create: true },
					);
					return {
						ok: true,
						handle: handleOf(db),
						path: file,
						readonly: readonly === true,
					};
				} catch (error) {
					return sqlFailure(error);
				}
			},

			close: ({ handle }: { handle: string }): CloseResult | SqlFailure => {
				const db = find(handle);
				if (!(db instanceof Database)) return db;
				open.delete(handle);
				db.close();
				return { ok: true, handle };
			},

			exec: async (args: SqlArgs): Promise<ExecResult | SqlFailure> => {
				const read = readSql(args);
				if (isFailure(read)) return read;
				const { sql, bound } = read;
				const db = find(args.handle);
				if (!(db instanceof Database)) return db;
				try {
					const run = db.prepare(sql).run(...(bound as never[]));
					return {
						ok: true,
						changes: run.changes,
						lastInsertRowid: Number(run.lastInsertRowid),
					};
				} catch (error) {
					return sqlFailure(error);
				}
			},

			query: async (args: SqlArgs): Promise<QueryResult | SqlFailure> => {
				const read = readSql(args);
				if (isFailure(read)) return read;
				const { sql, bound } = read;
				const db = find(args.handle);
				if (!(db instanceof Database)) return db;
				try {
					const rows = db.prepare(sql).all(...(bound as never[])) as SqlRow[];
					return { ok: true, rows };
				} catch (error) {
					return sqlFailure(error);
				}
			},

			get: async (args: SqlArgs): Promise<GetResult | SqlFailure> => {
				const read = readSql(args);
				if (isFailure(read)) return read;
				const { sql, bound } = read;
				const db = find(args.handle);
				if (!(db instanceof Database)) return db;
				try {
					const row = db.prepare(sql).get(...(bound as never[])) as SqlRow | null;
					return { ok: true, row: row ?? null };
				} catch (error) {
					return sqlFailure(error);
				}
			},
		},
	});
}

/** The default registration: `~/Library/Application Support/crust/*.sqlite` until an app names itself. */
export const databasePlugin = createDatabasePlugin();
