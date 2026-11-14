/**
 * The state the panels share: the folder, the notes in it, one status line, the
 * run log, and the two inline-edit flags.
 *
 * State only — every transition lives in a hook that takes this object — so a
 * component renders a value without owning behaviour, and two hooks can touch
 * the same field with no cycle between them.
 */
import { useCallback, useRef, useState } from "react";
import { logCommand } from "./api";
import { bridgeInfo } from "./bridge";
import type { Note } from "./notes";
import type { Reporter } from "./selfcheck";

export type Status = { kind: "idle" | "ok" | "bad"; text: string };
export type Editing = { mode: "new" | "rename"; value: string } | null;

export function useStore() {
	const [dir, setDir] = useState<string>("");
	const [notes, setNotes] = useState<Note[]>([]);
	const [status, setStatus] = useState<Status>({ kind: "idle", text: "opening notes…" });
	const [log, setLog] = useState<string[]>([]);
	const [editing, setEditing] = useState<Editing>(null);
	const [confirmDelete, setConfirmDelete] = useState(false);

	/** Read after a refresh by the boot path, which needs the list, not a render. */
	const notesRef = useRef<Note[]>([]);
	notesRef.current = notes;

	const logRef = useRef<string[]>([]);
	const report: Reporter = useCallback((line) => {
		logRef.current.push(line);
		setLog([...logRef.current]);
		// The terminal copy is what a scripted run asserts on; the panel keeps
		// the same line if the channel is ever unreachable.
		logCommand(line).catch(() => undefined);
	}, []);

	return {
		dir,
		setDir,
		notes,
		setNotes,
		notesRef,
		status,
		setStatus,
		log,
		report,
		editing,
		setEditing,
		confirmDelete,
		setConfirmDelete,
		info: bridgeInfo(),
	};
}

export type Store = ReturnType<typeof useStore>;
