/**
 * The header: the four page actions, plus the inline field Create and Rename
 * share. The field replaces nothing, it is a row of its own, which is why it is
 * a sibling of the bar rather than a child of it.
 */
import type { Editing } from "../store";

interface ToolbarProps {
	canSave: boolean;
	editing: Editing;
	setEditing: (next: Editing) => void;
	onOpenFolder: () => void;
	onSave: () => void;
	onSaveAs: () => void;
	onSubmitEditing: () => void;
}

export function Toolbar({
	canSave,
	editing,
	setEditing,
	onOpenFolder,
	onSave,
	onSaveAs,
	onSubmitEditing,
}: ToolbarProps) {
	return (
		<>
			<header className="bar">
				<div className="brand">
					<span className="dot" aria-hidden="true" />
					<h1>Dogear</h1>
					<span className="eyebrow">markdown notes</span>
				</div>
				<div className="actions">
					<button
						type="button"
						onClick={onOpenFolder}
						title="Pick a folder of notes with the native open panel"
					>
						Open folder…
					</button>
					<button type="button" onClick={() => setEditing({ mode: "new", value: "" })}>
						New
					</button>
					<button type="button" className="primary" onClick={onSave} disabled={!canSave}>
						Save
					</button>
					<button
						type="button"
						onClick={onSaveAs}
						disabled={!canSave}
						title="Write a copy wherever the native save panel points"
					>
						Save as…
					</button>
					<span className="hint">⌘S</span>
				</div>
			</header>

			{editing !== null && (
				<form
					className="field"
					onSubmit={(event) => {
						event.preventDefault();
						onSubmitEditing();
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
		</>
	);
}
