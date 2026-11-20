/**
 * E2E for the log system: a scratch app built through `crust build`, launched as its own binary
 * (never `open`), driven by a page that makes one granted invoke, one refused invoke, console
 * lines, an uncaught throw and then closes its own window so the app quits itself.
 * The proof is the JSONL on disk — `logs/app.jsonl`, its archive and the absence of any secret —
 * not the plugin's answer, so a log that exists but omits the failure fails here.
 */

import { mkdir, mkdtemp, rm, stat, symlink, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
	clearSurvivors,
	guardFocus,
	restoreFocus,
	runCommand,
	survivorsOf,
	Verdict,
} from "./e2e-harness.ts";
import { lastLine } from "./lib/text.ts";
import { checkLogs } from "./logs/assert.ts";
import {
	APP_ID,
	APP_NAME,
	BINARY_NAME,
	CONFIG_SOURCE,
	MAIN_SOURCE,
	PAGE_SOURCE,
} from "./logs/fixture.ts";

const REPO_ROOT = resolve(import.meta.dir, "..");
const CLI = join(REPO_ROOT, "src/cli/index.ts");

/** The data directory the app's own id names; the run is deterministic only if it starts empty. */
const APP_ROOT = join(homedir(), "Library", "Application Support", APP_ID);
const LOGS = join(APP_ROOT, "logs");

/** A cold build compiles the runtime and assembles the bundle; a loaded machine needs minutes. */
const BUILD_TIMEOUT_MS = 240_000;

/** One window, WebKit helpers and the page's own calls, measured well under this. */
const APP_TIMEOUT_MS = 25_000;

/** Write the project into a scratch directory and hand back the binary path. */
async function sandbox(scratch: string): Promise<string> {
	// The example imports `crust`, which resolves through this package's exports map; a scratch
	// copy has no install, so one symlink stands in for it (the window proof does the same).
	await mkdir(join(scratch, "node_modules"), { recursive: true });
	await symlink(REPO_ROOT, join(scratch, "node_modules", "crust"), "dir");
	await mkdir(join(scratch, "public"), { recursive: true });
	await writeFile(join(scratch, "crust.config.ts"), CONFIG_SOURCE, "utf8");
	await writeFile(join(scratch, "main.ts"), MAIN_SOURCE, "utf8");
	await writeFile(
		join(scratch, "public", "index.html"),
		'<!doctype html><title>Logs</title><script src="/app.js"></script>',
		"utf8",
	);
	await writeFile(join(scratch, "public", "app.js"), PAGE_SOURCE, "utf8");
	return join(scratch, "dist", `${APP_NAME}.app`, "Contents", "MacOS", BINARY_NAME);
}

async function main(): Promise<number> {
	if (process.platform !== "darwin") {
		console.log(
			`e2e-logs: SKIP  this proof builds a macOS .app and needs an Aqua session; ` +
				`running ${process.platform}/${process.arch}`,
		);
		return 1;
	}

	const verdict = new Verdict();
	// Armed before the probe launches its window. Its decision is what the `finally`
	// restores; a Ctrl-C runs no `finally`, so the guard also restores on `exit` and the
	// three signals.
	const frontmost = guardFocus();
	let scratch: string | undefined;
	let clean = false;
	try {
		// An archive or line set from an aborted run would make every assertion read the wrong
		// run. This directory belongs to this proof's app id and nothing else writes it.
		await rm(APP_ROOT, { recursive: true, force: true }).catch(() => undefined);

		scratch = await mkdtemp(join(tmpdir(), "crust-e2e-logs-"));
		const binary = await sandbox(scratch);
		await clearSurvivors(binary);

		const build = await runCommand([CLI, "build", "--dir", scratch], REPO_ROOT, {
			timeoutMs: BUILD_TIMEOUT_MS,
		});
		const built =
			build.code === 0 && (await stat(binary).catch(() => undefined))?.isFile() === true;
		verdict.check(
			"build",
			built,
			built
				? `crust build named ${binary}`
				: `crust build exited ${build.code} — ${lastLine(build.stderr) || lastLine(build.stdout) || "no output"}`,
		);

		if (!built) {
			const why = "not checked — crust build failed";
			for (const name of [
				"live file",
				"fields",
				"events",
				"forbidden",
				"rotation",
				"secrets",
			]) {
				verdict.check(name, false, why);
			}
			if (build.code !== 0) console.log(build.stdout + build.stderr);
			return verdict.report("e2e-logs");
		}

		// The app closes its own last window, and `main.ts` registers the listener that turns
		// that into a quit, so a clean exit is the app finishing rather than the harness stopping
		// it. Every log line is appended before the window goes away.
		const run = await runCommand([binary], scratch, { timeoutMs: APP_TIMEOUT_MS });
		clean = run.code === 0 && run.ended === "exit";
		verdict.check(
			"exit 0",
			clean,
			clean
				? "exited 0 on its own once the page closed the window"
				: `exit ${run.code ?? "null"}${run.ended === "timeout" ? " after the deadline" : ""}` +
						` — ${lastLine(run.stderr) || lastLine(run.stdout) || "no output"}`,
		);

		await checkLogs(verdict, LOGS);

		const survivors = await survivorsOf(binary);
		verdict.check(
			"no survivors",
			survivors.length === 0,
			survivors.length === 0
				? "no process matches the binary path"
				: `pid ${survivors.join(", ")} still running`,
		);
	} finally {
		if (scratch !== undefined)
			await rm(scratch, { recursive: true, force: true }).catch(() => undefined);
		// Last, so a red run does not leave the human looking at the window it opened.
		await restoreFocus(frontmost);
	}

	const allGreen = verdict.assertions.every((assertion) => assertion.ok);
	if (allGreen) await rm(APP_ROOT, { recursive: true, force: true }).catch(() => undefined);
	else console.log(`note  kept ${LOGS} for inspection`);

	return verdict.report("e2e-logs");
}

try {
	process.exit(await main());
} catch (error) {
	console.log(`e2e-logs: FAIL  ${error instanceof Error ? error.message : String(error)}`);
	process.exit(1);
}
