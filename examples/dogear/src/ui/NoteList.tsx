/**
 * The sidebar: the folder it is showing and one row per note, newest first.
 *
 * A row shows "unsaved" instead of its size while the editor holds a draft for
 * it, so the list is the place the dirty flag is visible without opening the note.
 */
import type { Note } from "../notes";

interface NoteListProps {
	dir: string;
	notes: Note[];
	activePath: string | null;
	dirty: boolean;
	onOpen: (note: Note) => void;
}

export function NoteList({ dir, notes, activePath, dirty, onOpen }: NoteListProps) {
	return (
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
								onClick={() => onOpen(note)}
								aria-current={isActive ? "true" : undefined}
							>
								<span className="name">{note.name.replace(/\.md$/, "")}</span>
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
	);
}
