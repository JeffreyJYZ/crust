/**
 * Dogear's own proof, run by the page when `DOGEAR_SELFCHECK=1`.
 *
 * Every call goes through `window.crust`, exactly as the UI calls it — no curl,
 * no second client, no click. One line per answer, mirrored to the terminal by
 * the `log` command, so a scripted run's stdout is evidence of what the page
 * saw. It touches one scratch file and no user note.
 *
 * The two file panels are the exception: `dialog.openPanel` and
 * `dialog.savePanel` each start an AppKit sheet, and only a human can complete
 * a *pick*. Step 10 cancels the folder sheet step 9 left up — the one panel
 * answer a scripted run can produce, since `dialog.cancel` is the page's own
 * Cancel button — and the save panel is left up, because there is no such way to
 * answer it. Nothing here writes a path the save panel answered with.
 */
import { describe, plugin } from "./bridge";
import { MARKDOWN_FILTERS, noteTitle, suggestedName, TRAY_ITEMS } from "./notes";

export type Reporter = (line: string) => void;

interface ListEntry {
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

/** Answers at `ms`, or reports that the call is still pending. */
function settle<T>(
	run: Promise<T>,
	ms: number,
): Promise<{ done: true; value: T } | { done: false }> {
	const timeout = new Promise<{ done: false }>((resolve) => {
		setTimeout(() => resolve({ done: false }), ms);
	});
	return Promise.race([run.then((value) => ({ done: true as const, value })), timeout]);
}

export async function runSelfCheck(report: Reporter, dir: string): Promise<void> {
	const pass = (name: string, detail: string) => report(`PASS ${name} — ${detail}`);
	const fail = (name: string, why: string) => report(`FAIL ${name} — ${why}`);

	/** Run one check; a throw is a FAIL line, never a silent gap. */
	const check = async <T,>(
		name: string,
		run: () => Promise<T>,
		ok: (value: T) => string | false,
	) => {
		try {
			const detail = ok(await run());
			if (detail === false) fail(name, "unexpected answer");
			else pass(name, detail);
			return detail !== false;
		} catch (error) {
			fail(name, describe(error));
			return false;
		}
	};

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
		return;
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

	// 9. The folder picker. A pick needs a human, so a sheet that is still up
	//    after a second and a half is the pass. The invoke is kept rather than
	//    dropped: step 10 cancels it, and that cancel has to be what answers it,
	//    so a non-null value here means "this run left a sheet up".
	let folderRun: Promise<{ paths: string[] }> | null = null;
	try {
		const pick = plugin<{ paths: string[] }>("dialog", "openPanel", {
			title: "Choose a folder of markdown notes",
			directory: true,
		});
		const raced = await settle(pick, 1500);
		if (!raced.done) {
			folderRun = pick;
			pass("dialog sheet", "NSOpenPanel is up; a pick needs a human, so it stays pending");
		} else {
			const picked = raced.value.paths[0];
			pass(
				"dialog sheet",
				picked === undefined
					? "NSOpenPanel answered with no path (cancelled)"
					: `NSOpenPanel answered ${picked}`,
			);
		}
	} catch (error) {
		fail("dialog sheet", describe(error));
	}

	// 10. The page's own cancel, then the save panel.
	//
	//     `dialog.cancel` is the way out of a sheet no human answered, and its
	//     own answer is not the evidence: the folder pick step 9 started has to
	//     resolve as cancelled, with no path, so a cancel that reported success
	//     while leaving the invoke pending fails here — and so does one that
	//     reports nothing pending while step 9's sheet is still up. Nothing is
	//     written either way. Then the save panel, asked the way the Save as…
	//     button asks it — one sheet at a time, so the folder one is gone first —
	//     and it stays up like the folder sheet did, because a pick needs a human.
	try {
		const cleared = await plugin<{ cancelled: boolean }>("dialog", "cancel", {});
		let cancelNote =
			"the folder sheet had already been answered, so there was nothing to cancel";
		if (folderRun !== null) {
			if (!cleared.cancelled) {
				throw new Error(
					"dialog.cancel reported nothing pending while the folder sheet from step 9 was up",
				);
			}
			const answered = await settle(folderRun, 1500);
			if (!answered.done) {
				throw new Error(
					"dialog.cancel answered cancelled but the folder pick never resolved",
				);
			}
			const paths = answered.value.paths ?? [];
			if (paths.length !== 0) {
				throw new Error(
					`dialog.cancel answered cancelled but the folder pick resolved ${paths.join(", ")}`,
				);
			}
			cancelNote =
				"the folder sheet was cancelled by the page and its pending invoke resolved with no path";
		}
		const panel = plugin<{ paths: string[] }>("dialog", "savePanel", {
			title: "Save a copy of the note",
			suggestedName: suggestedName(note.name),
			filters: MARKDOWN_FILTERS,
		});
		const raced = await settle(panel, 1500);
		if (!raced.done) {
			pass(
				"save panel",
				`NSSavePanel is up; ${cancelNote}; a pick needs a human, so this one stays pending`,
			);
		} else {
			const picked = raced.value.paths[0];
			pass(
				"save panel",
				picked === undefined
					? `NSSavePanel answered with no path (cancelled); ${cancelNote}; nothing was written`
					: `NSSavePanel answered ${picked}; ${cancelNote}; the check wrote nothing`,
			);
		}
	} catch (error) {
		fail("save panel", describe(error));
	}

	report("done");
}
