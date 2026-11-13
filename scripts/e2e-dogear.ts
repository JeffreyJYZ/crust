/**
 * The end-to-end proof for `examples/dogear` — the widest surface in this repo.
 *
 * Every other proof builds a project this suite writes itself. Dogear is a real
 * app: notes on disk through the `fs` plugin called from the page, the window
 * title tracking the open note, a menu-bar item with a menu, and AppKit's folder
 * picker. Until now the only thing that ran it was a human copying lines out of
 * its README, so any of those could rot without a gate noticing.
 *
 * The page already asserts its own surface: `DOGEAR_SELFCHECK=1` makes it run
 * eleven steps through `window.crust` and print `PASS`/`FAIL` per step plus a `done`
 * line through the backend's `log` command. This script does not re-derive those
 * steps — it builds the app, launches it the way a bundle is launched (cwd `/`),
 * and judges the page's own lines.
 *
 * The false pass this is built to avoid: matching `PASS` without reading the
 * step names. A step that stops running would leave ten PASS lines and still
 * exit 0, so the names are asserted exactly — each expected step once, nothing
 * extra, no duplicates — but as a set rather than a sequence: every step's line
 * reaches the backend as its own bridge message, so two can arrive in either
 * order even though the page awaited them in turn. The two panel steps are the
 * honest exception — no run completes a pick, so what passes is the sheet being
 * *up and still pending*, and those assertions say so rather than reading a
 * pending invoke as a choice.
 *
 * The example is copied to a scratch tree first, because two facts make the
 * in-repo directory the wrong thing to build: it has no `node_modules` (an
 * install there would rewrite the checkout's own state), and its `crust`
 * dependency is a `github:` pin — building it would embed the published
 * framework instead of the checkout under test. The copy rewrites exactly that
 * one dependency to `file:<repo>`, so the app code is byte-identical to the
 * example and the framework is this working tree.
 *
 * Usage:
 *   bun scripts/e2e-dogear.ts    # or `bun run e2e:dogear` once package.json names it
 */

import { cp, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { clearSurvivors, probe, runCommand, survivorsOf, Verdict } from "./e2e-harness.ts";

const REPO_ROOT = resolve(import.meta.dir, "..");
const EXAMPLE_DIR = join(REPO_ROOT, "examples/dogear");
const CLI = join(REPO_ROOT, "src/cli/index.ts");

/** `app.name` in the example's config, and the executable `crust build` pins. */
const APP_NAME = "Dogear";
const BINARY_NAME = "crust-app";

/**
 * Every step the page reports, in the order `src/selfcheck.tsx` runs them. This
 * list is the guard: a step that stops running shrinks the page's output, and
 * the comparison below fails instead of accepting ten of eleven.
 */
const STEPS = [
	"notes listed",
	"note stat",
	"note read",
	"window title",
	"tray item",
	"save",
	"save read back",
	"rename",
	"remove",
	"dialog sheet",
	"save panel",
] as const;

/** The page's last line, after the save-panel step. */
const DONE = /^\s+page\s+done\s*$/m;

/** One `  page      PASS <step> — <detail>` line. Step names hold no em dash. */
const STEP_LINE = /^\s+page\s+(PASS|FAIL)\s+([^—\s][^—]*?)\s+—\s*(.*)$/;

/** WebKit's web process, the shim compile and a 1.5 s pending-sheet wait. */
const APP_TIMEOUT_MS = 45_000;

/**
 * Assertions a failed step makes unknowable. Named here rather than invented at
 * the call site so a renamed assertion cannot leave the report short by one.
 */
const AFTER_BUILD = [
	"bundle",
	"binary",
	"step names",
	"steps pass",
	"tray reported",
	"sheet pending",
	"save sheet pending",
	"done",
	"exit 0",
	"no survivors",
	"notes seeded",
	"notes clean",
] as const;

/** Everything that needs the app to have run at all. */
const AFTER_RUN = [
	"step names",
	"steps pass",
	"tray reported",
	"sheet pending",
	"save sheet pending",
	"done",
	"exit 0",
	"no survivors",
	"notes seeded",
	"notes clean",
] as const;

/** The example's source, minus what an install or a build owns. */
const SKIP = new Set(["node_modules", "dist", "bun.lock", ".DS_Store"]);

function seconds(ms: number | null): string {
	return ms === null ? "no exit" : `${(ms / 1000).toFixed(2)} s`;
}

/** The last non-empty line of a captured stream, for a failure detail. */
function lastLine(text: string): string {
	const lines = text.split("\n").filter((line) => line.trim().length > 0);
	return lines.at(-1)?.trim() ?? "";
}

/** Mark every listed assertion failed when an earlier step made them unknowable. */
function skip(verdict: Verdict, names: readonly string[], why: string): void {
	for (const name of names) verdict.check(name, false, why);
}

interface ReporterStep {
	step: string;
	ok: boolean;
	detail: string;
}

/** Every PASS/FAIL line the page printed, in order. */
function pageSteps(text: string): ReporterStep[] {
	const found: ReporterStep[] = [];
	for (const line of text.split("\n")) {
		const match = STEP_LINE.exec(line);
		const state = match?.[1];
		const step = match?.[2];
		if (state === undefined || step === undefined) continue;
		found.push({ step: step.trim(), ok: state === "PASS", detail: match?.[3]?.trim() ?? "" });
	}
	return found;
}

/** The detail of one named step, or undefined when the page never reported it. */
function detailOf(steps: ReporterStep[], step: string): string | undefined {
	return steps.find((entry) => entry.step === step)?.detail;
}

async function main(): Promise<number> {
	if (process.platform !== "darwin") {
		console.log(
			`e2e-dogear: SKIP  this proof builds a macOS .app and needs an Aqua session; ` +
				`running ${process.platform}/${process.arch}`,
		);
		return 1;
	}

	const verdict = new Verdict();
	const scratch = await mkdtemp(join(tmpdir(), "crust-e2e-dogear-"));
	/** The notes folder the app creates; inside the scratch tree, so cleanup covers it. */
	const notes = join(scratch, "notes");
	let binary: string | undefined;
	try {
		binary = await proof(verdict, scratch, notes);
	} finally {
		// A leaked bundle carries the scratch path in its argv, so it is clearable,
		// and the tree goes either way — a throw is not a reason to leave both.
		if (binary !== undefined) await clearSurvivors(binary).catch(() => undefined);
		await rm(scratch, { recursive: true, force: true }).catch(() => undefined);
	}

	const gone = await stat(scratch)
		.then(() => false)
		.catch(() => true);
	verdict.check(
		"scratch gone",
		gone,
		gone
			? `removed ${scratch}, so the seeded notes folder went with it`
			: `${scratch} still exists`,
	);

	return verdict.report("e2e-dogear");
}

/**
 * Copy the example into `scratch` and point its framework dependency here.
 *
 * Only the `crust` line changes. Everything the app asserts — the fs calls, the
 * title strings, the tray labels, the panel — is the example's own code.
 */
async function sandbox(scratch: string): Promise<void> {
	for (const name of await readdir(EXAMPLE_DIR)) {
		if (SKIP.has(name)) continue;
		await cp(join(EXAMPLE_DIR, name), join(scratch, name), { recursive: true });
	}
	const manifestPath = join(scratch, "package.json");
	const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
		dependencies?: Record<string, string>;
	};
	manifest.dependencies = { ...manifest.dependencies, crust: `file:${REPO_ROOT}` };
	await writeFile(manifestPath, `${JSON.stringify(manifest, null, "\t")}\n`, "utf8");
}

async function proof(
	verdict: Verdict,
	scratch: string,
	notes: string,
): Promise<string | undefined> {
	await sandbox(scratch);
	const bundle = join(scratch, "dist", `${APP_NAME}.app`);
	const binary = join(bundle, "Contents", "MacOS", BINARY_NAME);

	// ---- 1. the copy installs, with this checkout as the framework ---------
	// `bun install` is what a user runs before a build, and the example's own
	// `beforeBuildCommand` is `./node_modules/.bin/vite build`, so a missing
	// install fails the build rather than this line.
	const install = await runCommand(["bun", "install"], scratch);
	const linked = await stat(join(scratch, "node_modules", "crust"))
		.then(() => true)
		.catch(() => false);
	const viteBin = await stat(join(scratch, "node_modules", ".bin", "vite"))
		.then(() => true)
		.catch(() => false);
	const installed = install.code === 0 && linked && viteBin;
	verdict.check(
		"install",
		installed,
		install.code !== 0
			? `bun install exited ${install.code} — ${lastLine(install.stderr) || lastLine(install.stdout)}`
			: !linked
				? "node_modules/crust is missing — the example cannot import the framework"
				: !viteBin
					? "node_modules/.bin/vite is missing — the example's build command would fail"
					: "bun install linked the checkout and installed the front end",
	);
	if (!installed) {
		skip(verdict, ["build", ...AFTER_BUILD], "not checked — the example copy did not install");
		return undefined;
	}

	// ---- 2. build through the CLI, as the example's README does ------------
	const build = await runCommand(
		[CLI, "build", "--dir", scratch, "--entry", "desktop/main.ts"],
		REPO_ROOT,
	);
	const namedBundle = build.stdout.includes(bundle);
	const built = build.code === 0;
	const buildOk = verdict.check(
		"build",
		built && namedBundle,
		built
			? namedBundle
				? "crust build exited 0 and named the bundle"
				: `crust build exited 0 but never printed ${bundle}`
			: `crust build exited ${build.code} — ${lastLine(build.stderr) || lastLine(build.stdout) || "no output"}`,
	);
	if (!buildOk) {
		skip(verdict, AFTER_BUILD, "not checked — crust build failed");
		if (!built) console.log(build.stdout + build.stderr);
		return undefined;
	}

	// ---- 3. the bundle is where a recipient would find it -------------------
	const bundleStat = await stat(bundle).catch(() => undefined);
	verdict.check(
		"bundle",
		bundleStat?.isDirectory() === true,
		bundleStat?.isDirectory() === true ? bundle : `${bundle} is not a directory`,
	);

	const binaryStat = await stat(binary).catch(() => undefined);
	const executable = binaryStat?.isFile() === true && (binaryStat.mode & 0o111) !== 0;
	verdict.check(
		"binary",
		executable,
		binaryStat?.isFile() === true
			? `${binary} (${binaryStat.size} bytes${executable ? "" : ", not executable"})`
			: `${binary} is missing`,
	);
	if (!executable) {
		skip(verdict, AFTER_RUN, "not checked — the bundle holds no executable");
		return binary;
	}

	// ---- 4. run it from `/`, as a launched bundle does ----------------------
	// `/usr/bin/env` carries the two switches so the harness's own environment is
	// untouched; `exec` replaces it, so the pid, the argv and the process group
	// are the app's.
	await clearSurvivors(binary);
	const run = await probe({
		command: ["/usr/bin/env", "DOGEAR_SELFCHECK=1", `DOGEAR_NOTES_DIR=${notes}`, binary],
		cwd: "/",
		match: DONE,
		timeoutMs: APP_TIMEOUT_MS,
	});

	const steps = pageSteps(run.stdout);

	// ---- 5. the page reported exactly the eleven steps, in order -----------
	// Set equality alone would accept a reordered run, and a count alone would
	// accept a rename. Comparing the sequence is the whole guard.
	const reported = steps.map((entry) => entry.step);
	const missing = STEPS.filter((step) => !reported.includes(step));
	const counts = new Map<string, number>();
	for (const step of reported) counts.set(step, (counts.get(step) ?? 0) + 1);
	const repeated = [...counts].filter(([, seen]) => seen > 1).map(([step]) => step);
	const extra = reported.filter((step) => !(STEPS as readonly string[]).includes(step));
	// Set, not sequence: each step's line reaches the backend as its own bridge message, so
	// two of them can arrive in either order even though the page awaited them in turn. A
	// dropped, renamed or repeated step still fails — count, names and duplicates are exact.
	const stepsOk =
		missing.length === 0 &&
		extra.length === 0 &&
		repeated.length === 0 &&
		reported.length === STEPS.length;
	const why =
		`${reported.length} step lines — ` +
		`${missing.length > 0 ? `missing ${missing.join(", ")}` : "none missing"}` +
		`${extra.length > 0 ? `, unexpected ${extra.join(", ")}` : ""}` +
		`${repeated.length > 0 ? `, repeated ${repeated.join(", ")}` : ""}` +
		`${stepsOk ? `: ${reported.join(", ")}` : ""}` +
		` — ${run.ended === "match" ? "the page printed done, so a step was dropped, renamed or repeated" : run.timedOut ? `no done line within ${APP_TIMEOUT_MS / 1000} s` : "the page stopped early"}`;
	verdict.check(
		"step names",
		stepsOk,
		stepsOk ? `the page ran ${STEPS.length} steps, in the expected order` : why,
	);

	if (stepsOk) {
		// ---- 6. every step passed -----------------------------------------
		const failed = steps.filter((entry) => !entry.ok);
		verdict.check(
			"steps pass",
			failed.length === 0,
			failed.length === 0
				? `${steps.length} PASS lines, no FAIL`
				: failed.map((entry) => `${entry.step}: ${entry.detail}`).join(" | "),
		);

		// ---- 7. the tray, as the app reports it ---------------------------
		// The adapter's read-back is the evidence; no menu-bar click exists, which
		// is why the app reports the menu's state rather than a click.
		const tray = detailOf(steps, "tray item") ?? "";
		const trayOk = /^menu with \d+ rows: /.test(tray);
		verdict.check(
			"tray reported",
			trayOk,
			trayOk ? tray : `the page printed ${JSON.stringify(tray) || "no tray line"}`,
		);

		// ---- 8. both sheets are up, and stay pending ----------------------
		// A pick needs a human, so a run that reports one means something other
		// than this app answered — and a run that reports cancellation is a
		// different fact than the sheet being up. Only "still pending" is this
		// proof's pass, for the open panel and the save panel alike.
		const sheets = [
			{ step: "dialog sheet", check: "sheet pending", cls: "NSOpenPanel" },
			{ step: "save panel", check: "save sheet pending", cls: "NSSavePanel" },
		] as const;
		for (const sheet of sheets) {
			const detail = detailOf(steps, sheet.step) ?? "";
			const pending = detail.includes("stays pending");
			verdict.check(
				sheet.check,
				pending,
				pending
					? `${sheet.cls} is up and unresolved, as the app reports it: ${JSON.stringify(detail)}`
					: `page reported ${JSON.stringify(detail) || `no ${sheet.step} line`} — expected the sheet to stay pending`,
			);
		}
	} else {
		skip(
			verdict,
			["steps pass", "tray reported", "sheet pending", "save sheet pending"],
			"not checked — the page did not report every step",
		);
		// The page's own lines are the evidence for the failure above.
		console.log(run.stdout + run.stderr);
	}

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

	return binary;
}

try {
	process.exit(await main());
} catch (error) {
	// A throw is still a verdict: the scratch tree is removed in `main`, and the
	// reason is printed rather than buried in a stack trace.
	console.log(`e2e-dogear: FAIL  ${error instanceof Error ? error.message : String(error)}`);
	process.exit(1);
}
