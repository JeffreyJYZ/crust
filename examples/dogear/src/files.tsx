/**
 * The folder and the note in the editor: listing, opening and saving.
 *
 * A draft differs from the text last read from or written to disk, and that
 * difference is what "unsaved" means everywhere else — the list row, the editor
 * head, the window title. Every path here is absolute: a built app runs with `/`
 * as its working directory, so a relative path would resolve to `/welcome.md`.
 */
import { useCallback, useState } from "react";
import { describe } from "./bridge";
import { readNote, readNotes, setWindowTitle, writeNote } from "./api";
import { noteTitle, type Note } from "./notes";
import type { Store } from "./store";

export function useFiles(store: Store) {
	const { dir, setDir, notes, setNotes, notesRef, setStatus, setEditing, setConfirmDelete } =
		store;
	const [drafts, setDrafts] = useState<Record<string, string>>({});
	const [saved, setSaved] = useState<Record<string, string>>({});
	const [activePath, setActivePath] = useState<string | null>(null);

	const text = activePath === null ? "" : (drafts[activePath] ?? "");
	const active = notes.find((note) => note.path === activePath);
	const dirty = activePath !== null && text !== (saved[activePath] ?? "");
	const heading = active?.name ?? "no note";
	const words = text.trim().length === 0 ? 0 : text.trim().split(/\s+/).length;

	const setNoteTitle = useCallback(
		async (name: string | undefined, isDirty: boolean) => {
			try {
				const answer = await setWindowTitle(noteTitle(name, isDirty));
				if (!answer?.ok) {
					setStatus({ kind: "bad", text: answer?.message ?? "window.setTitle refused" });
				}
			} catch (error) {
				setStatus({ kind: "bad", text: describe(error) });
			}
		},
		[setStatus],
	);

	const refresh = useCallback(
		async (target?: string) => {
			try {
				const listed = await readNotes(target ?? dir);
				if (target !== undefined) setDir(target);
				setNotes(listed);
				return listed;
			} catch (error) {
				setStatus({ kind: "bad", text: `listing ${target ?? dir}: ${describe(error)}` });
				return [];
			}
		},
		[dir, setDir, setNotes, setStatus],
	);

	const openNote = useCallback(
		async (note: Note) => {
			try {
				let body = drafts[note.path];
				if (body === undefined) {
					body = await readNote(note.path);
					setSaved((prev) => ({ ...prev, [note.path]: body as string }));
				}
				setDrafts((prev) => ({ ...prev, [note.path]: body as string }));
				setActivePath(note.path);
				setConfirmDelete(false);
				setEditing(null);
				await setNoteTitle(note.name, false);
				setStatus({ kind: "ok", text: `opened ${note.name}` });
			} catch (error) {
				setStatus({ kind: "bad", text: `open ${note.name}: ${describe(error)}` });
			}
		},
		[drafts, setNoteTitle, setStatus, setEditing, setConfirmDelete],
	);

	const save = useCallback(async () => {
		if (activePath === null) {
			setStatus({ kind: "bad", text: "nothing to save — open a note first" });
			return;
		}
		try {
			const answer = await writeNote(activePath, text);
			setSaved((prev) => ({ ...prev, [activePath]: text }));
			await refresh();
			const current = notesRef.current.find((note) => note.path === activePath);
			await setNoteTitle(current?.name, false);
			setStatus({
				kind: "ok",
				text: `saved ${activePath.split("/").pop()} · ${answer.bytes} bytes`,
			});
		} catch (error) {
			setStatus({ kind: "bad", text: `save: ${describe(error)}` });
		}
	}, [activePath, text, refresh, setNoteTitle, setStatus, notesRef]);

	return {
		drafts,
		setDrafts,
		saved,
		setSaved,
		activePath,
		setActivePath,
		text,
		active,
		dirty,
		heading,
		words,
		setNoteTitle,
		refresh,
		openNote,
		save,
	};
}

export type Files = ReturnType<typeof useFiles>;
