/**
 * SQLite opens files named by SQL as well as by `open`, so the name rule has to reach statements.
 * `ATTACH DATABASE ?` takes a path as a bound value and would otherwise open any file the process
 * can read or write, even on a read-only main handle. `VACUUM INTO` and `load_extension` name files
 * the same way.
 *
 * A bound attachment is allowed only when the bound value is a **name**: it goes through
 * `ensureDatabaseFile`, so the same token rule and canonical containment as `open` apply, and the
 * caller's value is replaced by the resolved path inside the data root before SQLite sees it. A
 * literal path, a `?NNN`/named binding, a multi-statement attach and an attach on a read-only handle
 * are refused rather than guessed at. A comment or a quoted string cannot smuggle a statement past
 * the check: the lexer hides both and splits on real statement boundaries.
 */

import { isFailure, sqlFailure, type Sql } from "./database-args.ts";
import { ensureDatabaseFile, type DatabasePathOptions } from "./database-name.ts";
import type { SqlFailure } from "./database-types.ts";

interface Token {
	kind: "word" | "param" | "literal" | "punct" | "other";
	text: string;
}

const wordChar = (char: string): boolean => /[A-Za-z0-9_$]/.test(char);

/** Strip comments and hide quoted identifiers; keep words, binding markers and string contents. */
function lex(sql: string): Token[] {
	const tokens: Token[] = [];
	for (let at = 0; at < sql.length;) {
		const char = sql[at]!;
		if (/\s/.test(char)) {
			at++;
			continue;
		}
		if (char === "-" && sql[at + 1] === "-") {
			while (at < sql.length && sql[at] !== "\n") at++;
			continue;
		}
		if (char === "/" && sql[at + 1] === "*") {
			const end = sql.indexOf("*/", at + 2);
			at = end === -1 ? sql.length : end + 2;
			continue;
		}
		if (char === "'") {
			let body = "";
			at++;
			while (at < sql.length) {
				if (sql[at] === "'" && sql[at + 1] === "'") {
					body += "'";
					at += 2;
					continue;
				}
				if (sql[at] === "'") {
					at++;
					break;
				}
				body += sql[at];
				at++;
			}
			tokens.push({ kind: "literal", text: body });
			continue;
		}
		if (char === '"' || char === "`" || char === "[") {
			const closing = char === "[" ? "]" : char;
			at++;
			while (at < sql.length && sql[at] !== closing) at++;
			at++;
			tokens.push({ kind: "other", text: "" });
			continue;
		}
		if (char === "?" || char === ":" || char === "@" || char === "$") {
			let text = char;
			at++;
			while (at < sql.length && wordChar(sql[at]!)) text += sql[at++];
			tokens.push({ kind: "param", text });
			continue;
		}
		if (wordChar(char)) {
			let text = "";
			while (at < sql.length && wordChar(sql[at]!)) text += sql[at++];
			tokens.push({ kind: "word", text: text.toUpperCase() });
			continue;
		}
		tokens.push({ kind: "punct", text: char });
		at++;
	}
	return tokens;
}

const keyword = (token: Token | undefined, name: string): boolean =>
	token?.kind === "word" && token.text === name;

/** A refusal naming the statement, never a silent skip of the rest of the string. */
const refuse = (what: string): SqlFailure =>
	sqlFailure(
		new Error(
			`database: ${what} is refused — a statement may not open a file outside the app's data directory`,
		),
	);

/** The first meaningful word, past an optional `EXPLAIN [QUERY PLAN]`. */
function leading(statement: Token[]): Token | undefined {
	let at = 0;
	if (keyword(statement[at], "EXPLAIN")) {
		at++;
		if (keyword(statement[at], "QUERY")) at++;
		if (keyword(statement[at], "PLAN")) at++;
	}
	return statement[at];
}

/**
 * Resolve the one bound name an `ATTACH` opens. The index is counted from plain `?` markers in the
 * statement, so the value SQLite receives is the file we approved, never the path the page typed.
 */
async function safeAttach(
	statement: Token[],
	read: Sql,
	options: DatabasePathOptions,
	readonly: boolean,
): Promise<Sql | SqlFailure> {
	if (readonly) return refuse("ATTACH on a readonly handle");
	const marker = statement.findIndex((token) => token.kind === "param");
	if (marker === -1) return refuse("ATTACH with a literal path");
	if (statement.some((token) => token.kind === "param" && token.text !== "?")) {
		return refuse("ATTACH with a numbered or named binding");
	}
	const index = statement.slice(0, marker).filter((token) => token.kind === "param").length;
	const file = await ensureDatabaseFile(read.bound[index], options).catch(sqlFailure);
	if (isFailure(file)) return file;
	read.bound[index] = file;
	return read;
}

/**
 * Check and, for a legitimate attach, rewrite one statement batch. Returns the statement and its
 * bound values, or the typed refusal a page branches on.
 */
export async function guardSql(
	read: Sql,
	options: DatabasePathOptions,
	readonly: boolean,
): Promise<Sql | SqlFailure> {
	const statements: Token[][] = [[]];
	for (const token of lex(read.sql)) {
		if (token.kind === "punct" && token.text === ";") statements.push([]);
		else statements[statements.length - 1]!.push(token);
	}
	for (const statement of statements) {
		const first = leading(statement);
		if (keyword(first, "ATTACH")) {
			if (statements.length > 1) return refuse("a multi-statement ATTACH");
			return await safeAttach(statement, read, options, readonly);
		}
		if (keyword(first, "VACUUM") && statement.some((token) => keyword(token, "INTO"))) {
			return refuse("VACUUM INTO");
		}
		if (
			statement.some(
				(token, at) => keyword(token, "LOAD_EXTENSION") && statement[at + 1]?.text === "(",
			)
		) {
			return refuse("load_extension");
		}
		if (keyword(first, "PRAGMA") && statement.some((token) => keyword(token, "DIRECTORY"))) {
			return refuse("a directory PRAGMA");
		}
	}
	return read;
}
