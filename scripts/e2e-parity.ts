/**
 * The runtime parity proof: `examples/parity-probe` is built the way a user builds, launched
 * from `/` by its own bundle binary, and its stdout has to carry one line per surface the
 * parity matrix used to mark "same" on compile evidence alone — menu, clipboard PNG,
 * window chrome and the shortcut seam — plus a `parity:` summary and exit 0.
 * The app exits on its own, so the probe's deadline is a hang guard, not the normal path.
 */

import { stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { clearSurvivors, probe, runCommand, survivorsOf, Verdict } from "./e2e-harness.ts";

const REPO_ROOT = resolve(import.meta.dir, "..");
const PROJECT_DIR = join(REPO_ROOT, "examples/parity-probe");
const CLI = join(REPO_ROOT, "src/cli/index.ts");

/** `app.name` in the probe's config, plus the binary name `cli/build.ts` pins. */
const BUNDLE = join(PROJECT_DIR, "dist", "Parity probe.app");
const BINARY = join(BUNDLE, "Contents", "MacOS", "crust-app");

/**
 * One pattern per proof. Each accepts the honest "not in this tree yet" form as well as the
 * proved form, because the probe must still pass the surfaces that are available; the exit
 * code carries the verdict, so a green line here never overstates what ran.
 */
const MENU = /^menu\s+(titles: .*"Probe item".*|read unavailable.*)$/m;
const CLIPBOARD = /^clipboard png \d+ bytes, first 8 89 50 4e 47 0d 0a 1a 0a$/m;
const RESTORED = /^clipboard restored: true$/m;
const CHROME = /^chrome\s+opacity 0\.75, decorations false$/m;
const SHORTCUT = /^shortcut\s+(emitted: command\+shift\+k|seam unavailable.*)$/m;
const SUMMARY = /^parity: (PASS|FAIL) \d+\/\d+$/m;

/** Shim compile, AppKit, four proofs: measured a few seconds, bounded generously. */
const APP_TIMEOUT_MS = 30_000;

function seconds(ms: number | null): string {
	return ms === null ? "no exit" : `${(ms / 1000).toFixed(2)} s`;
}

function lastLine(text: string): string {
	const lines = text.split("\n").filter((line) => line.trim().length > 0);
	return lines.at(-1)?.trim() ?? "";
}

/** The line a pattern found, or null when it found none. */
function lineOf(stdout: string, pattern: RegExp): string | null {
	const found = stdout.match(pattern);
	return found === null ? null : found[0].trim();
}

async function main(): Promise<number> {
	if (process.platform !== "darwin") {
		console.log(
			`e2e:parity: SKIP  this proof builds a macOS .app and needs an Aqua session; ` +
				`running ${process.platform}/${process.arch}`,
		);
		return 1;
	}

	const verdict = new Verdict();
	await clearSurvivors(BINARY);

	// ---- 1. build through the CLI, as a user runs it ------------------------
	const build = await runCommand([CLI, "build", "--dir", "examples/parity-probe"], REPO_ROOT);
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
		for (const name of ["binary", "menu", "clipboard", "chrome", "shortcut", "exit 0", "no survivors"]) {
			verdict.check(name, false, "not checked — crust build failed");
		}
		if (!built) console.log(build.stdout + build.stderr);
		return verdict.report("e2e:parity");
	}

	// ---- 2. the binary a recipient would run is there ----------------------
	const binaryStat = await stat(BINARY).catch(() => undefined);
	const executable = binaryStat?.isFile() === true && (binaryStat.mode & 0o111) !== 0;
	verdict.check(
		"binary",
		executable,
		binaryStat?.isFile() === true
			? `${BINARY} (${binaryStat.size} bytes${executable ? "" : ", not executable"})`
			: `${BINARY} is missing`,
	);

	// ---- 3. run it from `/`, which is what a double-clicked app gets -------
	const run = await probe({
		command: [BINARY],
		cwd: "/",
		match: SUMMARY,
		timeoutMs: APP_TIMEOUT_MS,
	});
	const missing = (name: string): string =>
		`no ${name} line within ${APP_TIMEOUT_MS / 1000} s — ` +
		(lastLine(run.stdout) || lastLine(run.stderr) || "the binary printed nothing");

	for (const [name, pattern] of [
		["menu", MENU],
		["clipboard", CLIPBOARD],
		["chrome", CHROME],
		["shortcut", SHORTCUT],
	] as const) {
		const line = lineOf(run.stdout, pattern);
		verdict.check(name, line !== null, line ?? missing(name));
	}

	const restored = lineOf(run.stdout, RESTORED);
	verdict.check(
		"restored",
		restored !== null,
		restored ?? `the pasteboard text was not put back — ${lastLine(run.stdout) || "no output"}`,
	);

	const summary = lineOf(run.stdout, SUMMARY);
	verdict.check(
		"summary",
		summary !== null && summary.startsWith("parity: PASS"),
		summary ?? missing("parity:"),
	);

	const cleanExit = run.code === 0;
	verdict.check(
		"exit 0",
		cleanExit,
		cleanExit
			? `exited 0 after ${seconds(run.exitMs)}`
			: `exit ${run.code ?? "null"}${run.signal ? ` (${String(run.signal)})` : ""}` +
					`${run.timedOut ? ` after the ${APP_TIMEOUT_MS / 1000} s deadline` : ""}`,
	);

	// ---- 4. nothing is left running ---------------------------------------
	const survivors = await survivorsOf(BINARY);
	verdict.check(
		"no survivors",
		survivors.length === 0,
		survivors.length === 0
			? "no process matches the binary path"
			: `pid ${survivors.join(", ")} still running`,
	);

	return verdict.report("e2e:parity");
}

try {
	process.exit(await main());
} catch (error) {
	await clearSurvivors(BINARY).catch(() => undefined);
	console.log(`e2e:parity: FAIL  ${error instanceof Error ? error.message : String(error)}`);
	process.exit(1);
}
