/**
 * Create, rename and delete — the three things that change the folder itself.
 *
 * Create and Rename share the inline field; only the target differs. Rename
 * refuses while a draft is unsaved, because the draft is keyed by the path and
 * moving the file would leave the text behind. Delete asks twice: the first
 * click only arms it.
 */
import { useCallback } from "react";
import { describe } from "./bridge";
import { checkedName, removeNote, renameNote, statNote, targetPath, writeNote } from "./api";
import type { Files } from "./files";
import type { Store } from "./store";

export function useEditing(store: Store, files: Files) {
	const { dir, setStatus, setEditing, setConfirmDelete, confirmDelete } = store;
	const {
		activePath,
		setActivePath,
		active,
		dirty,
		setDrafts,
		setSaved,
		refresh,
		openNote,
		setNoteTitle,
	} = files;

	const editing = store.editing;

	const submitEditing = useCallback(async () => {
		if (editing === null) return;
		const checked = checkedName(editing.value);
		if (!checked.ok) {
			setStatus({ kind: "bad", text: checked.why });
			return;
		}
		const target = targetPath(dir, checked.name);
		try {
			if (editing.mode === "new") {
				try {
					await statNote(target);
					setStatus({ kind: "bad", text: `${checked.name} already exists in ${dir}` });
					return;
				} catch (error) {
					// not-found is the answer that means "free to create".
					if ((error as { code?: string }).code !== "not-found") throw error;
				}
				await writeNote(target, `# ${checked.name.replace(/\.md$/, "")}\n\n`);
				const listed = await refresh();
				const created = listed.find((note) => note.path === target);
				if (created !== undefined) await openNote(created);
				setEditing(null);
				setStatus({ kind: "ok", text: `created ${checked.name}` });
				return;
			}

			if (activePath === null) {
				setStatus({ kind: "bad", text: "nothing to rename — open a note first" });
				return;
			}
			if (target === activePath) {
				setEditing(null);
				return;
			}
			if (dirty) {
				setStatus({
					kind: "bad",
					text: "save before renaming, or the draft would be left behind",
				});
				return;
			}
			const from = activePath;
			await renameNote(from, target);
			setDrafts((prev) => {
				const next = { ...prev };
				const body = next[from];
				if (body !== undefined) {
					delete next[from];
					next[target] = body;
				}
				return next;
			});
			setSaved((prev) => {
				const next = { ...prev };
				const body = next[from];
				if (body !== undefined) {
					delete next[from];
					next[target] = body;
				}
				return next;
			});
			setActivePath(target);
			await refresh();
			await setNoteTitle(checked.name, false);
			setEditing(null);
			setStatus({ kind: "ok", text: `renamed to ${checked.name}` });
		} catch (error) {
			setStatus({ kind: "bad", text: `${editing.mode}: ${describe(error)}` });
		}
	}, [
		editing,
		dir,
		activePath,
		dirty,
		refresh,
		openNote,
		setNoteTitle,
		setStatus,
		setEditing,
		setActivePath,
		setDrafts,
		setSaved,
	]);

	const removeActive = useCallback(async () => {
		if (activePath === null) return;
		if (!confirmDelete) {
			setConfirmDelete(true);
			setStatus({
				kind: "idle",
				text: `click Delete again to remove ${active?.name ?? "this note"}`,
			});
			return;
		}
		try {
			const answer = await removeNote(activePath);
			setDrafts((prev) => {
				const next = { ...prev };
				delete next[activePath];
				return next;
			});
			setSaved((prev) => {
				const next = { ...prev };
				delete next[activePath];
				return next;
			});
			setActivePath(null);
			setConfirmDelete(false);
			await refresh();
			await setNoteTitle(undefined, false);
			setStatus({
				kind: answer.removed ? "ok" : "bad",
				text: answer.removed ? `removed ${active?.name ?? "note"}` : "nothing was removed",
			});
		} catch (error) {
			setStatus({ kind: "bad", text: `delete: ${describe(error)}` });
		}
	}, [
		activePath,
		confirmDelete,
		active?.name,
		refresh,
		setNoteTitle,
		setStatus,
		setConfirmDelete,
		setActivePath,
		setDrafts,
		setSaved,
	]);

	return { submitEditing, removeActive };
}

export type EditingActions = ReturnType<typeof useEditing>;
