/**
 * `crust:database`'s argument reading and its refusals. Split out of `database.ts` when that file
 * crossed the 200-line cap; the shapes stay in `database-types.ts`.
 *
 * Every refusal here is a value, never a throw: a malformed payload answers the same
 * `{ ok: false, code, message }` shape as a SQL error, so a page reads one answer either way.
 */

import type { SqlArgs, SqlFailure } from "./database-types.ts";

const text = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** A thrown statement, as the typed refusal a page branches on. */
export function sqlFailure(error: unknown): SqlFailure {
	return { ok: false, code: "sql-error", message: text(error) };
}

/** A handle that was closed or never opened — not a SQL error, and never a throw. */
export function unknownHandle(handle: string): SqlFailure {
	return {
		ok: false,
		code: "unknown-handle",
		message: `database: no open handle "${handle}" — it was closed, or never opened`,
	};
}

export interface Sql {
	sql: string;
	bound: unknown[];
}

/**
 * A statement and its bound values, or the refusal. `args` is an array and nothing is interpolated
 * into the SQL, so a value carrying a quote stays data.
 */
export function readSql(args: unknown): Sql | SqlFailure {
	const value = args as Partial<SqlArgs> | undefined;
	if (typeof value?.sql !== "string" || value.sql.trim() === "") {
		return {
			ok: false,
			code: "sql-error",
			message: 'database: "sql" must be a non-empty string',
		};
	}
	const bound = value.args ?? [];
	if (!Array.isArray(bound)) {
		return {
			ok: false,
			code: "sql-error",
			message: 'database: "args" must be an array of bound values',
		};
	}
	return { sql: value.sql, bound };
}

/** Narrow a `T | SqlFailure` read so the failure arm is not re-checked field by field. */
export const isFailure = (value: unknown): value is SqlFailure =>
	typeof value === "object" && value !== null && (value as SqlFailure).ok === false;
