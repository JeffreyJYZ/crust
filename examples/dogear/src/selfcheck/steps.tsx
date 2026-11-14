/**
 * Steps 1–8: the folder on disk, one note in it, and the scratch file the run
 * writes, reads back, renames and removes.
 *
 * Every call goes through `window.crust`, exactly as the UI calls it, and each
 * answer is one line. It touches one scratch file and no user note.
 */
import { plugin } from "../bridge";
import { noteTitle, TRAY_ITEMS } from "../notes";
import type { Checks } from "./checks";

export interface ListEntry {
	name: string;
	path: string;
	directory: boolean;
	size: number;
}

interface StatAnswer {
	path: string;
	directory: boolean;
	size: number;
	modified: number;
}

interface TitleAnswer {
	ok: boolean;
	label?: string;
	title?: string;
	code?: string;
	message?: string;
}

interface TrayAnswer {
	ok: boolean;
	labels?: string[];
	message?: string;
}

/**
 * Run the file steps and answer with the note they read, or `undefined` when the
 * folder held none — the caller stops there instead of reporting a run that
 * never had anything to read.
 */
export async function runFileSteps(checks: Checks, dir: string): Promise<ListEntry | undefined> {
	const { check, report } = checks;

	// 1. The folder on disk, listed through the plugin the app uses.
	let first: ListEntry | undefined;
	await check(
		"notes listed",
		() => plugin<{ entries: ListEntry[] }>("fs", "list", { path: dir }),
		(answer) => {
			const notes = answer.entries.filter(
				(entry) =>
					!entry.directory && entry.name.endsWith(".md") && !entry.name.startsWith("."),
			);
			first = notes[0];
			return notes.length === 0
				? false
				: `${notes.length} markdown file(s) in ${dir} (${notes
						.map((note) => note.name)
						.join(", ")})`;
		},
	);

	if (first === undefined) {
		report("FAIL nothing to read — the folder held no markdown file");
		return undefined;
	}
	const note = first;

	// 2. Metadata for the list, from `fs.stat`.
	await check(
		"note stat",
		() => plugin<StatAnswer>("fs", "stat", { path: note.path }),
		(answer) =>
			`${answer.path} · ${answer.size} bytes · modified ${new Date(answer.modified).toISOString()}`,
	);

	// 3. The note itself, read from disk.
	await check(
		"note read",
		() => plugin<string>("fs", "readTextFile", { path: note.path }),
		(text) =>
			typeof text === "string" && text.length > 0
				? `${note.name} · ${text.length} chars, starts ${JSON.stringify(text.slice(0, 16))}`
				: false,
	);

	// 4. The window title, reflecting the note the editor holds. The adapter
	//    reads the applied title back before answering.
	await check(
		"window title",
		() =>
			plugin<TitleAnswer>("window", "setTitle", {
				label: "main",
				title: noteTitle(note.name),
			}),
		(answer) =>
			answer.ok && answer.title === noteTitle(note.name)
				? `${JSON.stringify(answer.title)} read back from the window`
				: false,
	);

	// 5. A menu-bar item with a menu — the state the tray adapter holds.
	await check(
		"tray item",
		() =>
			plugin<TrayAnswer>("tray", "setMenu", {
				items: TRAY_ITEMS.map((label) => ({ label })),
			}),
		(answer) =>
			answer.ok && (answer.labels?.length ?? 0) === TRAY_ITEMS.length
				? `menu with ${TRAY_ITEMS.length} rows: ${TRAY_ITEMS.join(", ")}`
				: false,
	);

	// 6. A save: write through `fs`, then read the bytes back.
	const scratch = "_selfcheck.md";
	const scratchPath = `${dir.replace(/\/+$/, "")}/${scratch}`;
	const body = `# self-check\n\nwritten by the page at ${new Date().toISOString()}\n`;
	const wrote = await check(
		"save",
		() =>
			plugin<{ bytes: number }>("fs", "writeTextFile", { path: scratchPath, contents: body }),
		(answer) =>
			answer.bytes > 0
				? `${scratch} · ${answer.bytes} bytes through fs.writeTextFile`
				: false,
	);
	if (wrote) {
		await check(
			"save read back",
			() => plugin<string>("fs", "readTextFile", { path: scratchPath }),
			(text) =>
				text === body ? `${scratch} · ${text.length} chars match what was written` : false,
		);
	}

	// 7. Rename, then 8. delete the same scratch file.
	const renamedPath = `${dir.replace(/\/+$/, "")}/_selfcheck-renamed.md`;
	const renamed = await check(
		"rename",
		() => plugin<{ path: string }>("fs", "rename", { from: scratchPath, to: renamedPath }),
		(answer) => (answer.path === renamedPath ? `${scratch} → _selfcheck-renamed.md` : false),
	);
	if (renamed) {
		await check(
			"remove",
			() => plugin<{ removed: boolean; path: string }>("fs", "remove", { path: renamedPath }),
			(answer) => (answer.removed ? `_selfcheck-renamed.md removed from ${dir}` : false),
		);
	}

	return note;
}
