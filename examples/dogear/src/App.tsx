/**
 * Composition only: four hooks own the behaviour, five components own the
 * markup, and this file is the wiring between them.
 *
 * The split follows what changes together — `api` for the calls, `store` for
 * shared state, `files` for the open note, `editing` for create/rename/delete,
 * `dialogs` for the native panels, `chrome` for the window, the tray and the
 * boot sequence — because the self-check and the UI must keep calling the same
 * things in the same order, and a 200-line file is the most that can be read at
 * once.
 */
import { useChrome } from "./chrome";
import { useDialogs } from "./dialogs";
import { useEditing } from "./editing";
import { useFiles } from "./files";
import { runSelfCheck } from "./selfcheck";
import { useStore } from "./store";
import { Diagnostics } from "./ui/Diagnostics";
import { Editor } from "./ui/Editor";
import { NoteList } from "./ui/NoteList";
import { StatusBar } from "./ui/StatusBar";
import { Toolbar } from "./ui/Toolbar";

export function App() {
	const store = useStore();
	const files = useFiles(store);
	const editing = useEditing(store, files);
	const dialogs = useDialogs(store, files);
	useChrome(store, files, dialogs);

	const { activePath, active, dirty } = files;

	return (
		<div className="shell">
			<Toolbar
				canSave={activePath !== null}
				editing={store.editing}
				setEditing={store.setEditing}
				onOpenFolder={dialogs.openFolder}
				onSave={files.save}
				onSaveAs={() => void dialogs.saveAs()}
				onSubmitEditing={() => void editing.submitEditing()}
			/>

			<main className="panes">
				<NoteList
					dir={store.dir}
					notes={store.notes}
					activePath={activePath}
					dirty={dirty}
					onOpen={(note) => void files.openNote(note)}
				/>
				<Editor
					heading={files.heading}
					dirty={dirty}
					words={files.words}
					active={active}
					confirmDelete={store.confirmDelete}
					text={files.text}
					onRename={() =>
						store.setEditing({
							mode: "rename",
							value: (active?.name ?? "").replace(/\.md$/, ""),
						})
					}
					onDelete={() => void editing.removeActive()}
					onChange={(value) => {
						if (activePath === null) return;
						files.setDrafts((prev) => ({ ...prev, [activePath]: value }));
					}}
					onTitleBlur={() => void files.setNoteTitle(active?.name, dirty)}
				/>
			</main>

			<StatusBar status={store.status} info={store.info} count={store.notes.length} />

			<Diagnostics log={store.log} onRun={() => void runSelfCheck(store.report, store.dir)} />
		</div>
	);
}
