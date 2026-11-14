/**
 * The editor pane: the open note's heading, its word count, rename and delete,
 * and the textarea itself.
 *
 * Delete arms before it fires — the button's own label is the confirmation — and
 * a blur re-applies the window title, because the dot means "the editor holds
 * text that is not on disk" and that is only settled when the person leaves.
 */
import type { Note } from "../notes";

interface EditorProps {
	heading: string;
	dirty: boolean;
	words: number;
	active: Note | undefined;
	confirmDelete: boolean;
	text: string;
	onRename: () => void;
	onDelete: () => void;
	onChange: (value: string) => void;
	onTitleBlur: () => void;
}

export function Editor({
	heading,
	dirty,
	words,
	active,
	confirmDelete,
	text,
	onRename,
	onDelete,
	onChange,
	onTitleBlur,
}: EditorProps) {
	return (
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
						onClick={onRename}
					>
						Rename
					</button>
					<button
						type="button"
						className={confirmDelete ? "small danger" : "small"}
						disabled={active === undefined}
						onClick={onDelete}
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
				onChange={(event) => onChange(event.target.value)}
				onBlur={onTitleBlur}
			/>
		</section>
	);
}
