/**
 * Every call the page makes, and the shapes it reads back.
 *
 * The state machine above this module sequences calls; it never spells a plugin
 * name or an argument shape, so a change to what `fs`, `window`, `dialog` or
 * `tray` takes lands here once. Answers keep the plugin's own types — nothing is
 * reshaped on the way through, because the status lines quote them.
 */
import { appCommand, plugin } from "./bridge";
import {
	MARKDOWN_FILTERS,
	noteFileName,
	notePath,
	sortNotes,
	suggestedName,
	type Note,
} from "./notes";

/** The one window this page drives; every window call names it. */
export const WINDOW = "main";

interface ListEntry {
	name: string;
	path: string;
	directory: boolean;
	size: number;
}

export interface StatAnswer {
	size: number;
	modified: number;
}

export interface TitleAnswer {
	ok: boolean;
	message?: string;
}

/** What a window call and a tray call answer with. */
export interface OkAnswer {
	ok: boolean;
	message?: string;
}

/** `fs.list` reports every entry; the sidebar wants markdown, newest first. */
export async function readNotes(dir: string): Promise<Note[]> {
	const { entries } = await plugin<{ entries: ListEntry[] }>("fs", "list", { path: dir });
	const files = entries.filter(
		(entry) => !entry.directory && entry.name.endsWith(".md") && !entry.name.startsWith("."),
	);
	const notes = await Promise.all(
		files.map(async (entry): Promise<Note> => {
			const info = await plugin<StatAnswer>("fs", "stat", { path: entry.path });
			return {
				name: entry.name,
				path: entry.path,
				size: info.size,
				modified: info.modified,
			};
		}),
	);
	return sortNotes(notes);
}

export function readNote(path: string): Promise<string> {
	return plugin<string>("fs", "readTextFile", { path });
}

export function writeNote(path: string, contents: string): Promise<{ bytes: number }> {
	return plugin<{ bytes: number }>("fs", "writeTextFile", { path, contents });
}

export function statNote(path: string): Promise<StatAnswer> {
	return plugin<StatAnswer>("fs", "stat", { path });
}

export function renameNote(from: string, to: string): Promise<{ path: string }> {
	return plugin<{ path: string }>("fs", "rename", { from, to });
}

export function removeNote(path: string): Promise<{ removed: boolean }> {
	return plugin<{ removed: boolean }>("fs", "remove", { path });
}

/** The window title; the adapter reads the applied title back before answering. */
export function setWindowTitle(title: string): Promise<TitleAnswer> {
	return plugin<TitleAnswer>("window", "setTitle", { label: WINDOW, title });
}

export function closeWindow(): Promise<OkAnswer> {
	return plugin<OkAnswer>("window", "close", { label: WINDOW });
}

export function focusWindow(): Promise<OkAnswer> {
	return plugin<OkAnswer>("window", "focus", { label: WINDOW });
}

/** The folder picker. An empty `paths` is the user cancelling: nothing happens. */
export function pickFolder(): Promise<{ paths: string[] }> {
	return plugin<{ paths: string[] }>("dialog", "openPanel", {
		title: "Choose a folder of markdown notes",
		directory: true,
	});
}

/** The save panel; it owns the folder and the name it starts with. */
export function pickSaveTarget(name: string | undefined): Promise<{ paths: string[] }> {
	return plugin<{ paths: string[] }>("dialog", "savePanel", {
		title: "Save a copy of the note",
		suggestedName: suggestedName(name),
		filters: MARKDOWN_FILTERS,
	});
}

/** The page's own Cancel for a sheet no human answered. */
export function cancelDialog(): Promise<{ cancelled: boolean }> {
	return plugin<{ cancelled: boolean }>("dialog", "cancel", {});
}

/** The backend's three commands, registered in `desktop/main.ts`. */
export function bootCommand(): Promise<{ dir: string; selfcheck: boolean }> {
	return appCommand("boot");
}

export function logCommand(line: string): Promise<unknown> {
	return appCommand("log", { line });
}

export function quitCommand(): Promise<unknown> {
	return appCommand("quit");
}

export function setTrayTitle(text: string): Promise<OkAnswer> {
	return plugin<OkAnswer>("tray", "setTitle", { text });
}

export function setTrayMenu(labels: readonly string[]): Promise<OkAnswer> {
	return plugin<OkAnswer>("tray", "setMenu", { items: labels.map((label) => ({ label })) });
}

/** A note name as the inline field leaves it: the same rules the create path uses. */
export function checkedName(raw: string): ReturnType<typeof noteFileName> {
	return noteFileName(raw.includes(".") ? raw : `${raw}.md`);
}

/** Join a checked name onto the folder, never onto a relative path. */
export function targetPath(dir: string, name: string): string {
	return notePath(dir, name);
}
