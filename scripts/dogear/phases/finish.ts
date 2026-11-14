/**
 * Phases 9-11: the run ended on its own terms, nothing is left running, and the
 * notes folder the app seeded is on disk and clean.
 */
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { type Probe, survivorsOf, type Verdict } from "../../e2e-harness.ts";
import { lastLine, seconds } from "../../lib/text.ts";
import { APP_TIMEOUT_MS } from "../fixture.ts";

export async function finishPhase(
	verdict: Verdict,
	run: Probe,
	binary: string,
	notes: string,
): Promise<void> {
	// ---- 9. the run ended on its own terms --------------------------------
	verdict.check(
		"done",
		run.matched !== null,
		run.matched !== null
			? `the page printed ${JSON.stringify(run.matched)}`
			: `no done line — ${lastLine(run.stdout) || lastLine(run.stderr) || "the app printed nothing"}`,
	);

	// The app is stopped by the harness once `done` appears (nothing in the page
	// quits it; the sheet is still up), so a clean exit is the runtime answering
	// SIGTERM with 0, and `ended: match` is what makes it that rather than an exit
	// that happened to be 0.
	const exitLine = run.timedOut
		? `still running after ${APP_TIMEOUT_MS / 1000} s`
		: `exited ${run.code ?? "null"}${run.signal ? ` (${String(run.signal)})` : ""} ` +
			`after ${seconds(run.exitMs)}`;
	const cleanExit = run.ended === "match" && run.code === 0 && !run.timedOut;
	verdict.check(
		"exit 0",
		cleanExit,
		cleanExit
			? `exited 0 after ${seconds(run.exitMs)}, stopped once the page printed done`
			: `${exitLine}${run.ended === "timeout" ? ", killed at the deadline" : ""}`,
	);

	// ---- 10. nothing is left running ---------------------------------------
	const survivors = await survivorsOf(binary);
	verdict.check(
		"no survivors",
		survivors.length === 0,
		survivors.length === 0
			? "no process matches the binary path"
			: `pid ${survivors.join(", ")} still running`,
	);

	// ---- 11. the notes folder the app seeded, and left clean ---------------
	// `boot` creates the folder and seeds `welcome.md` through the plugin, and the
	// page's own `remove` step deletes its scratch file. Both are read off disk
	// after the app is gone, so neither rests on the app's word for it.
	const seed = await stat(join(notes, "welcome.md")).catch(() => undefined);
	verdict.check(
		"notes seeded",
		seed?.isFile() === true,
		seed?.isFile() === true
			? `${join(notes, "welcome.md")} (${seed.size} bytes) was created by boot`
			: `${notes} holds no welcome.md — boot did not seed the folder`,
	);

	const leftovers = (await readdir(notes).catch(() => [] as string[])).filter((name) =>
		name.startsWith("_selfcheck"),
	);
	verdict.check(
		"notes clean",
		leftovers.length === 0,
		leftovers.length === 0
			? "the page's scratch file was renamed and removed; no _selfcheck file remains"
			: `${leftovers.join(", ")} still in ${notes}`,
	);
}
