import { useCallback, useEffect, useRef, useState } from "react";
import { appCommand, bridge, bridgeInfo, describe, plugin } from "./bridge";
import { noteFileName, notePath, noteTitle, sortNotes, TRAY_ITEMS, type Note } from "./notes";
import { runSelfCheck, type Reporter } from "./selfcheck";

const WINDOW = "main";

interface ListEntry {
	name: string;
	path: string;
	directory: boolean;
	size: number;
}

interface StatAnswer {
	size: number;
	modified: number;
}

interface TitleAnswer {
	ok: boolean;
	message?: string;
}

type Status = { kind: "idle" | "ok" | "bad"; text: string };
type Editing = { mode: "new" | "rename"; value: string } | null;

/** `fs.list` reports every entry; the sidebar wants markdown, newest first. */
async function readNotes(dir: string): Promise<Note[]> {
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

export function App() {
	const [dir, setDir] = useState<string>("");
	const [notes, setNotes] = useState<Note[]>([]);
	const [activePath, setActivePath] = useState<string | null>(null);
	const [drafts, setDrafts] = useState<Record<string, string>>({});
	const [saved, setSaved] = useState<Record<string, string>>({});
	const [status, setStatus] = useState<Status>({ kind: "idle", text: "opening notes…" });
	const [log, setLog] = useState<string[]>([]);
	const [editing, setEditing] = useState<Editing>(null);
	const [confirmDelete, setConfirmDelete] = useState(false);

	const booted = useRef(false);
	const notesRef = useRef<Note[]>([]);
	notesRef.current = notes;

	const text = activePath === null ? "" : (drafts[activePath] ?? "");
	const active = notes.find((note) => note.path === activePath);
	const dirty = activePath !== null && text !== (saved[activePath] ?? "");
	const heading = active?.name ?? "no note";
	const words = text.trim().length === 0 ? 0 : text.trim().split(/\s+/).length;
	const info = bridgeInfo();

	const setNoteTitle = useCallback(async (name: string | undefined, isDirty: boolean) => {
		try {
			const answer = await plugin<TitleAnswer>("window", "setTitle", {
				label: WINDOW,
				title: noteTitle(name, isDirty),
			});
			if (!answer?.ok) {
				setStatus({ kind: "bad", text: answer?.message ?? "window.setTitle refused" });
			}
		} catch (error) {
			setStatus({ kind: "bad", text: describe(error) });
		}
	}, []);

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
		[dir],
	);

	const openNote = useCallback(
		async (note: Note) => {
			try {
				let body = drafts[note.path];
				if (body === undefined) {
					body = await plugin<string>("fs", "readTextFile", { path: note.path });
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
		[drafts, setNoteTitle],
	);

	const save = useCallback(async () => {
		if (activePath === null) {
			setStatus({ kind: "bad", text: "nothing to save — open a note first" });
			return;
		}
		try {
			const answer = await plugin<{ bytes: number }>("fs", "writeTextFile", {
				path: activePath,
				contents: text,
			});
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
	}, [activePath, text, refresh, setNoteTitle]);

	const openFolder = useCallback(async () => {
		setStatus({ kind: "idle", text: "waiting for the folder picker…" });
		try {
			const answer = await plugin<{ paths: string[] }>("dialog", "openPanel", {
				title: "Choose a folder of markdown notes",
				directory: true,
			});
			const picked = answer?.paths[0];
			if (picked === undefined) {
				setStatus({ kind: "idle", text: "folder picker cancelled" });
				return;
			}
			const listed = await refresh(picked);
			setStatus({ kind: "ok", text: `${listed.length} note(s) in ${picked}` });
		} catch (error) {
			setStatus({ kind: "bad", text: `openPanel: ${describe(error)}` });
		}
	}, [refresh]);

	/** Create and Rename share the inline field; only the target differs. */
	const submitEditing = useCallback(async () => {
		if (editing === null) return;
		const checked = noteFileName(
			editing.value.includes(".") ? editing.value : `${editing.value}.md`,
		);
		if (!checked.ok) {
			setStatus({ kind: "bad", text: checked.why });
			return;
		}
		const target = notePath(dir, checked.name);
		try {
			if (editing.mode === "new") {
				try {
					await plugin<StatAnswer>("fs", "stat", { path: target });
					setStatus({ kind: "bad", text: `${checked.name} already exists in ${dir}` });
					return;
				} catch (error) {
					// not-found is the answer that means "free to create".
					if ((error as { code?: string }).code !== "not-found") throw error;
				}
				await plugin("fs", "writeTextFile", {
					path: target,
					contents: `# ${checked.name.replace(/\.md$/, "")}\n\n`,
				});
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
			await plugin<{ path: string }>("fs", "rename", { from, to: target });
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
	}, [editing, dir, activePath, dirty, refresh, openNote, setNoteTitle]);

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
			const answer = await plugin<{ removed: boolean }>("fs", "remove", { path: activePath });
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
	}, [activePath, confirmDelete, active?.name, refresh, setNoteTitle]);

	const closeWindow = useCallback(async () => {
		try {
			const answer = await plugin<{ ok: boolean; message?: string }>("window", "close", {
				label: WINDOW,
			});
			setStatus({
				kind: answer?.ok ? "ok" : "bad",
				text: answer?.ok
					? "window closed — reopen it from the Dogear menu-bar item"
					: (answer?.message ?? "close refused"),
			});
		} catch (error) {
			setStatus({ kind: "bad", text: describe(error) });
		}
	}, []);

	const reopenWindow = useCallback(async () => {
		try {
			const answer = await plugin<{ ok: boolean; message?: string }>("window", "focus", {
				label: WINDOW,
			});
			setStatus({
				kind: answer?.ok ? "ok" : "bad",
				text: answer?.ok ? "window reopened" : (answer?.message ?? "focus refused"),
			});
		} catch (error) {
			setStatus({ kind: "bad", text: describe(error) });
		}
	}, []);

	const quit = useCallback(async () => {
		setStatus({ kind: "idle", text: "quitting…" });
		await appCommand("quit").catch(() => undefined);
	}, []);

	const logRef = useRef<string[]>([]);
	const report: Reporter = useCallback((line) => {
		logRef.current.push(line);
		setLog([...logRef.current]);
		// The terminal copy is what a scripted run asserts on; the panel keeps
		// the same line if the channel is ever unreachable.
		appCommand("log", { line }).catch(() => undefined);
	}, []);

	/** The tray's clicks arrive as an event, so its handlers have to stay current. */
	const actions = useRef({ save, closeWindow, reopenWindow, quit });
	actions.current = { save, closeWindow, reopenWindow, quit };

	/** Boot runs once; `openNote` changes identity on every keystroke, so it is read here. */
	const openNoteRef = useRef(openNote);
	openNoteRef.current = openNote;

	useEffect(() => {
		if (booted.current) return;
		booted.current = true;

		void (async () => {
			report(`page mounted at ${window.location.href}`);
			let bootDir = "";
			let selfcheck = false;
			try {
				// Not a gate: `ready` waits for the SSE stream, and an app that
				// needs a stream before its first invoke deadlocks when it is refused.
				const ready = await Promise.race([
					bridge().ready.then(() => "ready" as const),
					new Promise<"pending">((resolve) => setTimeout(() => resolve("pending"), 2000)),
				]);
				const boot = await appCommand<{ dir: string; selfcheck: boolean }>("boot");
				bootDir = boot.dir;
				selfcheck = boot.selfcheck;
				setDir(boot.dir);
				const listed = await refresh(boot.dir);
				setStatus({
					kind: "ok",
					text: `${listed.length} note(s) in ${boot.dir} · bridge ${ready}`,
				});
				report(`boot ok — ${listed.length} note(s) in ${boot.dir} · bridge ${ready}`);
			} catch (error) {
				const why = describe(error);
				setStatus({ kind: "bad", text: `boot: ${why}` });
				report(`boot failed — ${why}`);
			}

			try {
				const titled = await plugin<{ ok: boolean; message?: string }>("tray", "setTitle", {
					text: "Dogear",
				});
				const menu = await plugin<{ ok: boolean; message?: string }>("tray", "setMenu", {
					items: TRAY_ITEMS.map((label) => ({ label })),
				});
				if (!titled?.ok)
					setStatus({ kind: "bad", text: titled?.message ?? "tray.setTitle refused" });
				else if (!menu?.ok)
					setStatus({ kind: "bad", text: menu?.message ?? "tray.setMenu refused" });
			} catch (error) {
				setStatus({ kind: "bad", text: `tray: ${describe(error)}` });
			}

			if (selfcheck && bootDir !== "") {
				await runSelfCheck(report, bootDir);
				return;
			}
			const first = notesRef.current[0];
			if (first !== undefined) await openNoteRef.current(first);
		})();
	}, [refresh, report]);

	useEffect(() => {
		try {
			return bridge().listen<{ index: number; label: string }>("tray:click", ({ label }) => {
				if (label === "Save now") void actions.current.save();
				else if (label === "Close window") void actions.current.closeWindow();
				else if (label === "Reopen window") void actions.current.reopenWindow();
				else if (label === "Quit Dogear") void actions.current.quit();
			});
		} catch {
			return undefined;
		}
	}, []);

	useEffect(() => {
		const onKey = (event: KeyboardEvent) => {
			if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
				event.preventDefault();
				void save();
			}
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [save]);

	return (
		<div className="shell">
			<header className="bar">
				<div className="brand">
					<span className="dot" aria-hidden="true" />
					<h1>Dogear</h1>
					<span className="eyebrow">markdown notes</span>
				</div>
				<div className="actions">
					<button
						type="button"
						onClick={openFolder}
						title="Pick a folder of notes with the native open panel"
					>
						Open folder…
					</button>
					<button type="button" onClick={() => setEditing({ mode: "new", value: "" })}>
						New
					</button>
					<button
						type="button"
						className="primary"
						onClick={save}
						disabled={activePath === null}
					>
						Save
					</button>
					<span className="hint">⌘S</span>
				</div>
			</header>

			{editing !== null && (
				<form
					className="field"
					onSubmit={(event) => {
						event.preventDefault();
						void submitEditing();
					}}
				>
					<input
						// biome-ignore lint/a11y/noAutofocus: the field exists because the user asked for it
						autoFocus
						value={editing.value}
						placeholder={editing.mode === "new" ? "note name" : "new name"}
						onChange={(event) =>
							setEditing({ mode: editing.mode, value: event.target.value })
						}
						onKeyDown={(event) => {
							if (event.key === "Escape") setEditing(null);
						}}
					/>
					<button type="submit" className="primary">
						{editing.mode === "new" ? "Create" : "Rename"}
					</button>
					<button type="button" onClick={() => setEditing(null)}>
						Cancel
					</button>
				</form>
			)}

			<main className="panes">
				<aside className="list" aria-label="notes">
					<p className="eyebrow">{dir || "notes"}</p>
					{notes.length === 0 && <p className="empty">no notes here</p>}
					<ul>
						{notes.map((note) => {
							const isActive = note.path === activePath;
							return (
								<li key={note.path}>
									<button
										type="button"
										className={isActive ? "row active" : "row"}
										onClick={() => void openNote(note)}
										aria-current={isActive ? "true" : undefined}
									>
										<span className="name">
											{note.name.replace(/\.md$/, "")}
										</span>
										<span className="meta">
											{isActive && dirty
												? "unsaved"
												: `${Math.max(1, Math.round(note.size / 1024))} KB`}
										</span>
									</button>
								</li>
							);
						})}
					</ul>
				</aside>

				<section className="editor">
					<div className="editor-head">
						<h2>
							{heading}
							{dirty && <span className="unsaved">unsaved</span>}
						</h2>
						<div className="editor-actions">
							<span className="count">{words} words</span>
							<button
								type="button"
								className="small"
								disabled={active === undefined}
								onClick={() =>
									setEditing({
										mode: "rename",
										value: (active?.name ?? "").replace(/\.md$/, ""),
									})
								}
							>
								Rename
							</button>
							<button
								type="button"
								className={confirmDelete ? "small danger" : "small"}
								disabled={active === undefined}
								onClick={() => void removeActive()}
							>
								{confirmDelete ? "Delete for good?" : "Delete"}
							</button>
						</div>
					</div>
					<textarea
						aria-label={`contents of ${heading}`}
						value={text}
						spellCheck
						placeholder="pick a note, or start a new one"
						onChange={(event) => {
							if (activePath === null) return;
							setDrafts((prev) => ({ ...prev, [activePath]: event.target.value }));
						}}
						onBlur={() => void setNoteTitle(active?.name, dirty)}
					/>
				</section>
			</main>

			<footer className="status" role="status" aria-live="polite">
				<span className={`badge ${status.kind}`} aria-hidden="true" />
				<span className="status-text">{status.text}</span>
				<span className="bridge" title={info.url || "the bridge serves this document"}>
					bridge {info.url || (info.connected ? "embedded" : "missing")} · {notes.length}{" "}
					notes
				</span>
			</footer>

			<details className="diagnostics" open={log.length > 0}>
				<summary>
					Diagnostics
					<button
						type="button"
						className="small"
						onClick={(event) => {
							event.preventDefault();
							void runSelfCheck(report, dir);
						}}
					>
						Run self-check
					</button>
				</summary>
				<pre>{log.length === 0 ? "no checks run yet" : log.join("\n")}</pre>
			</details>
		</div>
	);
}
