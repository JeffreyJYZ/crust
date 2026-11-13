/**
 * The path guard, kept apart from `main.ts` so it can be tested without an app.
 *
 * A note name arrives from the page, which means it is untrusted input. Two
 * independent checks run on it: a character whitelist (no separators, no drive
 * letters, no NUL, no `.`/`..`) and, after resolving, a containment check that
 * the resulting path is still one segment directly inside the notes directory.
 * The first check is what produces a readable message; the second is what holds
 * if the first is ever relaxed by mistake.
 */
import { isAbsolute, relative, resolve } from "node:path";

/** Notes live beside the app: `notes/` in the directory crust runs from. */
export const NOTES_DIR = resolve(process.cwd(), "notes");

export const NOTE_EXTENSION = ".md";

/** Long enough for a sentence, short enough to be a filename. */
export const MAX_NAME_LENGTH = 64;

/**
 * ASCII only, and never a leading dot: a name cannot begin with `..`, cannot
 * carry a separator, and cannot introduce a hidden file.
 */
const ALLOWED_NAME = /^[A-Za-z0-9][A-Za-z0-9 ._-]*$/;

export type NotePathFailure = { ok: false; code: "bad-name"; message: string };
export type NotePath = { ok: true; name: string; path: string };
export type NotePathResult = NotePath | NotePathFailure;

function refuse(name: unknown, reason: string): NotePathFailure {
	const shown = typeof name === "string" ? JSON.stringify(name) : String(name);
	console.log(`  notes     refused ${shown}: ${reason}`);
	return { ok: false, code: "bad-name", message: `${shown} is not a usable note name — ${reason}` };
}

/**
 * Validate a page-supplied name and resolve it to a file inside `base`.
 *
 * Every rejection names the rule it broke, so the page can show the reason
 * instead of a generic failure.
 */
export function resolveNotePath(name: unknown, base: string = NOTES_DIR): NotePathResult {
	if (typeof name !== "string") {
		return refuse(name, "a note name must be a string");
	}

	const trimmed = name.trim();
	if (trimmed.length === 0) {
		return refuse(name, "the name is empty");
	}
	if (trimmed.length > MAX_NAME_LENGTH) {
		return refuse(name, `the name is longer than ${MAX_NAME_LENGTH} characters`);
	}
	if (trimmed.includes("\0")) {
		return refuse(name, "the name contains a NUL byte");
	}
	if (isAbsolute(trimmed)) {
		return refuse(name, "absolute paths are not note names");
	}
	if (trimmed.includes("/") || trimmed.includes("\\")) {
		return refuse(name, "path separators are not allowed");
	}
	if (trimmed === "." || trimmed === "..") {
		return refuse(name, "`.` and `..` are directory references, not note names");
	}
	if (!ALLOWED_NAME.test(trimmed)) {
		return refuse(
			name,
			"use letters, digits, spaces, dots, dashes or underscores, starting with a letter or digit",
		);
	}

	const path = resolve(base, `${trimmed}${NOTE_EXTENSION}`);

	// Belt and braces: even if the whitelist above were loosened, a resolved
	// path must be exactly one segment under `base`. `relative` answers with a
	// `..` prefix when it is not, and an absolute answer when the bases differ.
	const inside = relative(base, path);
	if (
		inside.length === 0 ||
		isAbsolute(inside) ||
		inside.startsWith("..") ||
		inside.includes("/") ||
		inside.includes("\\") ||
		inside.includes("\0")
	) {
		return refuse(name, "the resolved path escapes the notes directory");
	}

	return { ok: true, name: trimmed, path };
}
