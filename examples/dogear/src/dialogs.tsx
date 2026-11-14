/**
 * The three native panels: open a folder, save a copy, cancel a sheet.
 *
 * A picker is a *sheet*, so it is modal to its window — which is why the way out
 * of one is a menu-bar row, not a button behind it, and why each of these keeps
 * its own status line while the sheet is up.
 */
import { useCallback } from "react";
import { describe } from "./bridge";
import { cancelDialog, logCommand, pickFolder, pickSaveTarget, writeNote } from "./api";
import type { Files } from "./files";
import type { Store } from "./store";

export function useDialogs(store: Store, files: Files) {
	const { dir, setStatus } = store;
	const { activePath, active, text, refresh, setSaved, setNoteTitle } = files;

	/**
	 * Save a copy where the user says.
	 *
	 * `dialog.savePanel` owns the folder and the name; this only writes the
	 * editor's text to whatever path it answers with, through the same
	 * `fs.writeTextFile` the plain Save uses. An empty `paths` is the user
	 * cancelling: nothing is written, nothing is removed and nothing throws.
	 */
	const saveAs = useCallback(async () => {
		if (activePath === null) {
			setStatus({ kind: "bad", text: "nothing to save — open a note first" });
			return;
		}
		setStatus({ kind: "idle", text: "waiting for the save panel…" });
		try {
			const answer = await pickSaveTarget(active?.name);
			const target = answer?.paths?.[0];
			if (target === undefined) {
				setStatus({ kind: "idle", text: "save panel cancelled — nothing was written" });
				return;
			}
			const written = await writeNote(target, text);
			if (target === activePath) {
				// Saving over the open note settles its draft, dot included.
				setSaved((prev) => ({ ...prev, [activePath]: text }));
				await setNoteTitle(active?.name, false);
			}
			const folder = dir.replace(/\/+$/, "");
			if (folder !== "" && target.startsWith(`${folder}/`)) await refresh();
			setStatus({
				kind: "ok",
				text: `saved ${target.split("/").pop()} · ${written.bytes} bytes`,
			});
		} catch (error) {
			setStatus({ kind: "bad", text: `savePanel: ${describe(error)}` });
		}
	}, [activePath, active?.name, text, dir, refresh, setNoteTitle, setStatus, setSaved]);

	const openFolder = useCallback(async () => {
		setStatus({ kind: "idle", text: "waiting for the folder picker…" });
		try {
			const answer = await pickFolder();
			const picked = answer?.paths[0];
			if (picked === undefined) {
				setStatus({ kind: "idle", text: "folder picker cancelled" });
				return;
			}
			const listed = await refresh(picked);
			// A completed pick is the one thing no script can produce, so it is recorded
			// where a person can see it: the README's "two checks only a person can do"
			// tells the reader to look for this line.
			logCommand(`panel — picked ${picked}`).catch(() => undefined);
			setStatus({ kind: "ok", text: `${listed.length} note(s) in ${picked}` });
		} catch (error) {
			setStatus({ kind: "bad", text: `openPanel: ${describe(error)}` });
		}
	}, [refresh, setStatus]);

	/**
	 * End a sheet no human answered.
	 *
	 * It is a menu-bar row rather than a page button because a picker is modal
	 * to the window it is attached to: the page behind it is disabled, so the
	 * tray is the app's only in-app way out that a person can still reach while
	 * a folder or save sheet is up. A cancel answers the pending invoke with the
	 * same `{ paths: [] }` the panel's own Cancel button gives it, and nothing
	 * else changes.
	 */
	const cancelPanel = useCallback(async () => {
		try {
			const answer = await cancelDialog();
			setStatus({
				kind: "idle",
				text: answer?.cancelled
					? "panel cancelled — nothing was picked"
					: "no panel was open",
			});
		} catch (error) {
			setStatus({ kind: "bad", text: `cancel: ${describe(error)}` });
		}
	}, [setStatus]);

	return { saveAs, openFolder, cancelPanel };
}

export type Dialogs = ReturnType<typeof useDialogs>;
