/**
 * E2E for the multi-file app: every asset under `public/` embedded in the bundle, a backend owning its state, and a page that calls a command on load — built by `crust build`, then its binary launched directly (never `open`).
 * The child runs in a scratch directory with one seeded note because a built app keeps its notes beside its launch directory; that makes the reported count checkable. macOS has no `timeout(1)`, so the deadline and the SIGKILL escalation are in `e2e-harness.ts`.
 */

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { clearSurvivors, probe, survivorsOf, Verdict } from "./e2e-harness.ts";
import { lastLine, seconds } from "./lib/text.ts";
import { BINARY, buildPhase } from "./notes/build.ts";

/** `notes.list` logs this once the page's call has been answered. */
const LISTED = /notes\s+listed\s+(\d+)\s+\(page call answered\)/;

/** The one note seeded into the scratch directory, so the count is not zero. */
const SEED_NAME = "seed";

/** Hard deadline for the app: a window plus WebKit's web process, measured ~1 s. */
const APP_TIMEOUT_MS = 15_000;

async function main(): Promise<number> {
	if (process.platform !== "darwin") {
		console.log(
			`e2e-notes: SKIP  this proof builds a macOS .app and needs an Aqua session; ` +
				`running ${process.platform}/${process.arch}`,
		);
		return 1;
	}

	const verdict = new Verdict();

	// A survivor from an aborted run would make the last assertion meaningless,
	// so clear ours before starting. The pattern is this bundle's own path.
	await clearSurvivors(BINARY);

	// A scratch directory, because the app writes `notes/` beside its cwd and the
	// repo root is not a place to leave state. `finally` removes it either way.
	const scratch = await mkdtemp(join(tmpdir(), "crust-e2e-notes-"));
	try {
		if (!(await buildPhase(verdict))) return verdict.report("e2e-notes");
		return await proof(verdict, scratch);
	} finally {
		await rm(scratch, { recursive: true, force: true }).catch(() => undefined);
	}
}

async function proof(verdict: Verdict, scratch: string): Promise<number> {
	// ---- 5. run it, and prove the page reached the backend -----------------
	const notesDir = join(scratch, "notes");
	await mkdir(notesDir, { recursive: true });
	await writeFile(join(notesDir, `${SEED_NAME}.md`), "# a note on disk\n", "utf8");

	const run = await probe({
		command: [BINARY],
		cwd: scratch,
		match: LISTED,
		timeoutMs: APP_TIMEOUT_MS,
	});
	verdict.check(
		"listed",
		run.matched !== null,
		run.matched ??
			`no notes.list answer within ${APP_TIMEOUT_MS / 1000} s — ` +
				(lastLine(run.stdout) || lastLine(run.stderr) || "the binary printed nothing"),
	);

	// The count is the backend's report of the directory this script seeded, so
	// a page that never ran, or a list read from somewhere else, is visible here.
	const reported = run.matched?.match(LISTED)?.[1];
	const counted = reported === "1";
	verdict.check(
		"count",
		counted,
		counted
			? `the backend listed ${reported}, and notes/ holds 1 note`
			: reported === undefined
				? "no count to check — the listed line never arrived"
				: `the backend listed ${reported}, but notes/ holds 1 note`,
	);

	// An exit after the deadline is the harness stopping an app that never
	// answered, not the app stopping itself, so it does not count as clean.
	const cleanExit = run.code === 0 && !run.timedOut;
	verdict.check(
		"exit 0",
		cleanExit,
		cleanExit
			? `exited 0 after ${seconds(run.exitMs)}`
			: `exit ${run.code ?? "null"}${run.signal ? ` (${String(run.signal)})` : ""}` +
					`${run.timedOut ? ` after the ${APP_TIMEOUT_MS / 1000} s deadline` : ""}`,
	);

	// ---- 6. nothing is left running ---------------------------------------
	const survivors = await survivorsOf(BINARY);
	verdict.check(
		"no survivors",
		survivors.length === 0,
		survivors.length === 0
			? "no process matches the binary path"
			: `pid ${survivors.join(", ")} still running`,
	);

	return verdict.report("e2e-notes");
}

try {
	process.exit(await main());
} catch (error) {
	// A throw is still a verdict: clean up what we started, then say what broke.
	await clearSurvivors(BINARY).catch(() => undefined);
	console.log(`e2e-notes: FAIL  ${error instanceof Error ? error.message : String(error)}`);
	process.exit(1);
}
