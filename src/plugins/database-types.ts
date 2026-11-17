/**
 * `crust:database`'s public shapes, split out of `database.ts` when that file crossed the 200-line
 * cap. The fix for a cap is another file, never a trimmed comment.
 */

export type SqlRow = Record<string, unknown>;

/** Why a statement failed. `unknown-handle` is a closed or never-opened handle, not a SQL error. */
export interface SqlFailure {
	ok: false;
	code: "sql-error" | "unknown-handle";
	message: string;
}

export type SqlOutcome<Value> = ({ ok: true } & Value) | SqlFailure;

/** What a statement is given: the handle to run it on, the SQL, and bound values. */
export interface SqlArgs {
	handle: string;
	sql: string;
	/** Bound parameters, in `?` order. Never interpolated into the SQL. */
	args?: unknown[];
}

export interface OpenArgs {
	/** A name, never a path: it resolves inside the app's data directory. */
	name: string;
	readonly?: boolean;
}

export interface OpenResult {
	ok: true;
	handle: string;
	path: string;
	readonly: boolean;
}

export interface CloseResult {
	ok: true;
	handle: string;
}

export interface ExecResult {
	ok: true;
	changes: number;
	lastInsertRowid: number;
}

export interface QueryResult {
	ok: true;
	rows: SqlRow[];
}

export interface GetResult {
	ok: true;
	/** The first row, or `null` when the statement matched nothing. */
	row: SqlRow | null;
}
