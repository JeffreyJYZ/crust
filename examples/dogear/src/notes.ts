/**
 * The note rules the page and its self-check share.
 *
 * A page never composes a path out of thin air: `boot` answers with an absolute
 * folder, and every path the app sends back to `fs` is joined onto it here.
 */

export interface Note {
	/** Basename, never a path. */
	name: string;
	/** Absolute, because a built app runs with `/` as its working directory. */
	path: string;
	size: number;
	/** Milliseconds since the epoch, from `fs.stat`. */
	modified: number;
}

/** The menu-bar rows; a click comes back as `tray:click { index, label }`. */
export const TRAY_ITEMS = ["Save now", "Close window", "Reopen window", "Quit Dogear"] as const;

export const EXTENSION = ".md";

/** The window title: the open note, plus a dot while the editor holds unsaved text. */
export function noteTitle(name: string | undefined, dirty = false): string {
	if (name === undefined) return "Dogear";
	return `Dogear — ${name}${dirty ? " •" : ""}`;
}

export type NameCheck = { ok: true; name: string } | { ok: false; why: string };

/**
 * A note name is untrusted: one path segment, `.md`, no dotfile, no separator,
 * no NUL. A refused name is a message the page renders, not an exception.
 */
export function noteFileName(raw: string): NameCheck {
	const name = raw.trim();
	if (name.length === 0) return { ok: false, why: "a note needs a name" };
	if (name.length > 120) return { ok: false, why: "a note name is at most 120 characters" };
	if (name.includes("/") || name.includes("\\") || name.includes("\0")) {
		return { ok: false, why: "a note name is one path segment" };
	}
	if (name === "." || name === ".." || name.startsWith(".")) {
		return { ok: false, why: "a note name cannot start with a dot" };
	}
	if (!name.endsWith(EXTENSION)) return { ok: false, why: `a note name ends with ${EXTENSION}` };
	return { ok: true, name };
}

/** Join onto the folder `boot` answered with, never onto a relative path. */
export function notePath(dir: string, name: string): string {
	return `${dir.replace(/\/+$/, "")}/${name}`;
}

/** Markdown files only, newest first — `fs.list` reports every entry. */
export function sortNotes(notes: Note[]): Note[] {
	return [...notes].sort((left, right) => right.modified - left.modified);
}
