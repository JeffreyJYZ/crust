/**
 * The end-to-end proof for `crust dev`: the other half of `e2e.ts`.
 *
 * A built bundle is one path a user takes; the other is the watcher, and it is
 * a different shape — the CLI spawns a runtime child, that child opens the
 * window and serves the page, and the watcher outlives it. So the proof starts
 * `crust dev` exactly as the README does, waits for the page's own `greet`
 * answer, then terminates the process group and asserts two things a user
 * depends on: a clean exit, and nothing left behind.
 *
 * Terminating the group rather than the CLI alone is deliberate: `crust dev`
 * owns a child process, and a harness that kills only the parent would leave a
 * window and a `Bun.serve` alive while reporting success.
 *
 * Usage:
 *   bun scripts/e2e-dev.ts    # or `bun run e2e:dev` once package.json defines it
 */

import { join, resolve } from "node:path";
import { clearSurvivors, probe, survivorsOf, Verdict } from "./e2e-harness.ts";

const REPO_ROOT = resolve(import.meta.dir, "..");
const PROJECT_DIR = join(REPO_ROOT, "examples/hello");
const CLI = join(REPO_ROOT, "src/cli/index.ts");
const CONFIG = join(PROJECT_DIR, "crust.config.ts");

/** The page's answer over the bridge — the same line `e2e.ts` asserts on. */
const GREET = /greet\s+hello jyz \(page call answered\)/;
/** `app.on("ready")` in examples/hello/main.ts, printed when the window is up. */
const WINDOW = /window\s+Hello crust is open/;

/** Watcher startup, the shim compile and WebKit's web process, generously bounded. */
const DEV_TIMEOUT_MS = 30_000;

/**
 * Survivor patterns. The CLI's own argv names `--dir examples/hello`; the runtime
 * child it spawns carries the resolved config path. Both must be gone.
 */
const SURVIVOR_PATTERNS = [CONFIG, "dev --dir examples/hello"];

/** The last non-empty line of a captured stream, for a failure detail. */
function lastLine(text: string): string {
	return (
		text
			.split("\n")
			.filter((line) => line.trim().length > 0)
			.at(-1)
			?.trim() ?? ""
	);
}

async function main(): Promise<number> {
	if (process.platform !== "darwin") {
		console.log(
			`e2e-dev: SKIP  this proof opens a macOS window and needs an Aqua session; ` +
				`running ${process.platform}/${process.arch}`,
		);
		return 1;
	}

	const verdict = new Verdict();
	for (const pattern of SURVIVOR_PATTERNS) {
		await clearSurvivors(pattern);
	}

	const run = await probe({
		command: ["bun", "run", CLI, "dev", "--dir", "examples/hello"],
		cwd: REPO_ROOT,
		match: GREET,
		timeoutMs: DEV_TIMEOUT_MS,
	});

	verdict.check(
		"greet",
		run.matched !== null,
		run.matched ??
			`no greet answer within ${DEV_TIMEOUT_MS / 1000} s — ` +
				(lastLine(run.stdout) || lastLine(run.stderr) || "crust dev printed nothing"),
	);
	verdict.check(
		"window",
		WINDOW.test(run.stdout),
		WINDOW.test(run.stdout)
			? "the runtime reported its window open"
			: "no window line — the platform did not reach ready",
	);

	// SIGTERM on the process group is what the probe already sent; dev handles it
	// by stopping its child and returning 0, so a non-zero code here means the
	// watcher had to be killed instead of stopping.
	const cleanExit = run.code === 0;
	verdict.check(
		"exit 0",
		cleanExit,
		cleanExit
			? `crust dev exited 0 after ${((run.exitMs ?? 0) / 1000).toFixed(2)} s`
			: `exit ${run.code ?? "null"}${run.signal ? ` (${String(run.signal)})` : ""}` +
					`${run.timedOut ? ` after the ${DEV_TIMEOUT_MS / 1000} s deadline` : ""}`,
	);

	const survivors: number[] = [];
	for (const pattern of SURVIVOR_PATTERNS) {
		survivors.push(...(await survivorsOf(pattern)));
	}
	verdict.check(
		"no survivors",
		survivors.length === 0,
		survivors.length === 0
			? "no dev or runtime process remains"
			: `pid ${survivors.join(", ")} still running`,
	);

	return verdict.report("e2e-dev");
}

try {
	process.exit(await main());
} catch (error) {
	for (const pattern of SURVIVOR_PATTERNS) {
		await clearSurvivors(pattern).catch(() => undefined);
	}
	console.log(`e2e-dev: FAIL  ${error instanceof Error ? error.message : String(error)}`);
	process.exit(1);
}
