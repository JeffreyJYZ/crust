/**
 * Everything the page does to its own frame: the window, the menu bar, and the
 * two listeners that live outside React.
 *
 * The boot effect is the entry point — it reports the mount, reads `boot`, sets
 * the tray up and either runs the self-check or opens the first note. The tray's
 * clicks arrive as events, so its handlers are read through a ref that stays
 * current; `openNote` changes identity on every keystroke for the same reason.
 */
import { useCallback, useEffect, useRef } from "react";
import {
	closeWindow as closeMainWindow,
	focusWindow as focusMainWindow,
	quitCommand,
	setTrayMenu,
	setTrayTitle,
	bootCommand,
	logCommand,
} from "./api";
import { bridge, describe } from "./bridge";
import { TRAY_ITEMS } from "./notes";
import type { Dialogs } from "./dialogs";
import type { Files } from "./files";
import { runSelfCheck } from "./selfcheck";
import type { Store } from "./store";

export function useChrome(store: Store, files: Files, dialogs: Dialogs): void {
	const { setDir, setStatus, report, notesRef } = store;
	const { save, openNote, refresh } = files;
	const { cancelPanel } = dialogs;

	const closeWindow = useCallback(async () => {
		try {
			const answer = await closeMainWindow();
			setStatus({
				kind: answer?.ok ? "ok" : "bad",
				text: answer?.ok
					? "window closed — reopen it from the Dogear menu-bar item"
					: (answer?.message ?? "close refused"),
			});
		} catch (error) {
			setStatus({ kind: "bad", text: describe(error) });
		}
	}, [setStatus]);

	const reopenWindow = useCallback(async () => {
		try {
			const answer = await focusMainWindow();
			setStatus({
				kind: answer?.ok ? "ok" : "bad",
				text: answer?.ok ? "window reopened" : (answer?.message ?? "focus refused"),
			});
		} catch (error) {
			setStatus({ kind: "bad", text: describe(error) });
		}
	}, [setStatus]);

	const quit = useCallback(async () => {
		setStatus({ kind: "idle", text: "quitting…" });
		await quitCommand().catch(() => undefined);
	}, [setStatus]);

	/** The tray's clicks arrive as an event, so its handlers have to stay current. */
	const actions = useRef({ save, cancelPanel, closeWindow, reopenWindow, quit });
	actions.current = { save, cancelPanel, closeWindow, reopenWindow, quit };

	/** Boot runs once; `openNote` changes identity on every keystroke, so it is read here. */
	const openNoteRef = useRef(openNote);
	openNoteRef.current = openNote;

	const booted = useRef(false);

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
				const boot = await bootCommand();
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
				const titled = await setTrayTitle("Dogear");
				const menu = await setTrayMenu(TRAY_ITEMS);
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
	}, [refresh, report, setDir, setStatus, notesRef]);

	useEffect(() => {
		try {
			return bridge().listen<{ index: number; label: string }>("tray:click", ({ label }) => {
				// The click leg has no other witness: the page cannot see the menu bar, so the
				// terminal line is what proves a human clicked a row.
				logCommand(`tray click — ${label}`).catch(() => undefined);
				if (label === "Save now") void actions.current.save();
				else if (label === "Cancel panel") void actions.current.cancelPanel();
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
}
