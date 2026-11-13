/**
 * The end-to-end proof for the multi-file app: `examples/notes`.
 *
 * `e2e.ts` proves the smallest path — one command, one asset-free page. This one
 * proves the shape a real app has: three files under `public/` embedded in the
 * bundle, a backend that owns its state, and a page that calls a command on load.
 * Everything goes through the real path: `crust build` compiles and signs the
 * bundle, then the binary inside it is launched directly — never `open`, which
 * would route through LaunchServices and hide which process ran.
 *
 * The app proves itself by printing the `notes.list` line its page triggers. A
 * built app keeps its notes beside the directory it is launched from, so the
 * child runs in a scratch directory with one seeded note rather than the repo
 * root; that also makes the reported count a fact this script can check.
 *
 * Usage:
 *   bun scripts/e2e-notes.ts    # or `bun run e2e:notes`
 *
 * macOS has no `timeout(1)`, so the deadline, the SIGTERM and the escalation to
 * SIGKILL all live in `e2e-harness.ts`. A hung app must fail, never pass: the
 * listed line is missing, and an exit that only happened because the deadline
 * killed the child is not a clean exit.
 */

import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { clearSurvivors, probe, runCommand, survivorsOf, Verdict } from "./e2e-harness.ts";

const REPO_ROOT = resolve(import.meta.dir, "..");
const PROJECT_DIR = join(REPO_ROOT, "examples/notes");
const CLI = join(REPO_ROOT, "src/cli/index.ts");

/** `app.name` in examples/notes/crust.config.ts, plus the binary name build.ts pins. */
const BUNDLE = join(PROJECT_DIR, "dist", "Notes.app");
const BINARY = join(BUNDLE, "Contents", "MacOS", "crust-app");

/** What `public/` holds: index.html, app.js, style.css — embedded whole. */
const ASSET_COUNT = 3;

/** `notes.list` logs this once the page's call has been answered. */
const LISTED = /notes\s+listed\s+(\d+)\s+\(page call answered\)/;

/** The one note seeded into the scratch directory, so the count is not zero. */
const SEED_NAME = "seed";

/** Hard deadline for the app: a window plus WebKit's web process, measured ~1 s. */
const APP_TIMEOUT_MS = 15_000;

function seconds(ms: number | null): string {
	return ms === null ? "no exit" : `${(ms / 1000).toFixed(2)} s`;
}

/** The last non-empty line of a captured stream, for a failure detail. */
function lastLine(text: string): string {
	const lines = text.split("\n").filter((line) => line.trim().length > 0);
	return lines.at(-1)?.trim() ?? "";
}

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
		return await proof(verdict, scratch);
	} finally {
		await rm(scratch, { recursive: true, force: true }).catch(() => undefined);
	}
}

async function proof(verdict: Verdict, scratch: string): Promise<number> {
	// ---- 1. build through the CLI, as a user runs it ------------------------
	const build = await runCommand(
		["bun", "run", CLI, "build", "--dir", "examples/notes"],
		REPO_ROOT,
	);
	const namedBundle = build.stdout.includes(BUNDLE);
	const built = build.code === 0;
	const buildOk = verdict.check(
		"build",
		built && namedBundle,
		built
			? namedBundle
				? "crust build exited 0 and named the bundle"
				: `crust build exited 0 but never printed ${BUNDLE}`
			: `crust build exited ${build.code} — ${lastLine(build.stderr) || lastLine(build.stdout) || "no output"}`,
	);
	if (!buildOk) {
		const why = "not checked — crust build failed";
		for (const name of [
			"assets",
			"bundle",
			"binary",
			"codesign",
			"listed",
			"exit 0",
			"no survivors",
		]) {
			verdict.check(name, false, why);
		}
		if (!built) console.log(build.stdout + build.stderr);
		return verdict.report("e2e-notes");
	}

	// ---- 2. the page is embedded, not read from a project directory ---------
	const assetsLine = new RegExp(`assets\\s+${ASSET_COUNT} files from public/`).test(build.stdout);
	verdict.check(
		"assets",
		assetsLine,
		assetsLine
			? `crust build embedded ${ASSET_COUNT} files from public/`
			: `crust build never reported ${ASSET_COUNT} assets — ${lastLine(build.stdout)}`,
	);

	// ---- 3. the bundle is where a recipient would find it -------------------
	const bundleStat = await stat(BUNDLE).catch(() => undefined);
	verdict.check(
		"bundle",
		bundleStat?.isDirectory() === true,
		bundleStat?.isDirectory() === true ? BUNDLE : `${BUNDLE} is not a directory`,
	);

	const binaryStat = await stat(BINARY).catch(() => undefined);
	const executable = binaryStat?.isFile() === true && (binaryStat.mode & 0o111) !== 0;
	verdict.check(
		"binary",
		executable,
		binaryStat?.isFile() === true
			? `${BINARY} (${binaryStat.size} bytes${executable ? "" : ", not executable"})`
			: `${BINARY} is missing`,
	);

	// ---- 4. ad-hoc signed, which is what `crust build` promises -------------
	const signature = await runCommand(["codesign", "-dv", "--verbose=4", BUNDLE], REPO_ROOT);
	const signatureText = `${signature.stderr}${signature.stdout}`;
	const adhoc = signature.code === 0 && /^Signature=adhoc$/m.test(signatureText);
	verdict.check(
		"codesign",
		adhoc,
		adhoc
			? "codesign -dv reports Signature=adhoc"
			: lastLine(signatureText) || "codesign -dv printed nothing",
	);

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
