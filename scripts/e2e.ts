/**
 * The end-to-end proof: build the example through the CLI, then run the
 * bundle's own binary and judge what a user would see.
 *
 * This is deliberately not a unit test. Everything below goes through the real
 * path: `crust build` compiles a wrapper with Bun, assembles `Hello crust.app`,
 * ad-hoc signs it, and the binary inside the bundle is what runs. If any of
 * that stops working, this script says which step, in one line, and exits 1.
 *
 * The app is launched directly — never `open`, which routes through
 * LaunchServices and Gatekeeper and would hide which process ran.
 *
 * Usage:
 *   bun scripts/e2e.ts        # or `bun run e2e` once package.json defines it
 *
 * The binary opens a window and stays alive, so it proves itself by printing
 * the page's `greet` answer; the proof then stops it with SIGTERM (the runtime
 * exits 0 on that) and asserts nothing survived. macOS has no `timeout(1)`, so
 * the deadline and the escalation to SIGKILL are in `e2e-harness.ts`.
 */

import { stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { clearSurvivors, probe, runCommand, survivorsOf, Verdict } from "./e2e-harness.ts";

const REPO_ROOT = resolve(import.meta.dir, "..");
const PROJECT_DIR = join(REPO_ROOT, "examples/hello");
const CLI = join(REPO_ROOT, "src/cli/index.ts");

/** `app.name` in examples/hello/crust.config.ts, plus the binary name build.ts pins. */
const BUNDLE = join(PROJECT_DIR, "dist", "Hello crust.app");
const BINARY = join(BUNDLE, "Contents", "MacOS", "crust-app");

/**
 * The page calls `invoke("greet", { name: "jyz" })`; the backend logs the answer
 * with this exact shape. Matching the whole line, not the word "hello", keeps
 * the assertion about the round trip rather than about output existing.
 */
const GREET = /greet\s+hello jyz \(page call answered\)/;

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
			`e2e: SKIP  this proof builds a macOS .app and needs an Aqua session; ` +
				`running ${process.platform}/${process.arch}`,
		);
		return 1;
	}

	const verdict = new Verdict();

	// A survivor from an aborted run would make the last assertion meaningless,
	// so clear ours before starting. The pattern is this bundle's own path.
	await clearSurvivors(BINARY);

	// ---- 1. build through the CLI, as a user runs it ------------------------
	const build = await runCommand(
		["bun", "run", CLI, "build", "--dir", "examples/hello"],
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
		for (const name of ["bundle", "binary", "codesign", "greet", "exit 0", "no survivors"]) {
			verdict.check(name, false, why);
		}
		if (!built) console.log(build.stdout + build.stderr);
		return verdict.report("e2e");
	}

	// ---- 2. the bundle is where a recipient would find it -------------------
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

	// ---- 3. ad-hoc signed, which is what `crust build` promises -------------
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

	// ---- 4. run it, and prove the page reached the backend -----------------
	// Launched from `/`, which is what a double-clicked app gets: a built app must carry
	// its config, never load one from the working directory. Running this from the repo
	// root once masked a wrapper that imported a second copy of the framework.
	const run = await probe({
		command: [BINARY],
		cwd: "/",
		match: GREET,
		timeoutMs: APP_TIMEOUT_MS,
	});
	verdict.check(
		"greet",
		run.matched !== null,
		run.matched ??
			`no greet answer within ${APP_TIMEOUT_MS / 1000} s — ` +
				(lastLine(run.stdout) || lastLine(run.stderr) || "the binary printed nothing"),
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

	// ---- 5. nothing is left running ---------------------------------------
	const survivors = await survivorsOf(BINARY);
	verdict.check(
		"no survivors",
		survivors.length === 0,
		survivors.length === 0
			? "no process matches the binary path"
			: `pid ${survivors.join(", ")} still running`,
	);

	return verdict.report("e2e");
}

try {
	process.exit(await main());
} catch (error) {
	// A throw is still a verdict: clean up what we started, then say what broke.
	await clearSurvivors(BINARY).catch(() => undefined);
	console.log(`e2e: FAIL  ${error instanceof Error ? error.message : String(error)}`);
	process.exit(1);
}
