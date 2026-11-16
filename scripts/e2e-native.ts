/**
 * E2E for `examples/native`: the two native extensions are compiled by the repo's own pipeline, then
 * a real `crust dev` loads them and the page's `window.crust.invoke` reaches each dylib and gets an
 * answer back. The probe waits for the Rust answer, which the page only asks for after the Zig one
 * resolved, so one line proves both calls crossed the bridge.
 * A dylib that fails to dlopen shows up as `extensions … loaded` below its file count or as a
 * missing `direct` line — the two numbers the runtime prints before any page exists.
 */

import { stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
	clearSurvivors,
	probe,
	restoreFocus,
	runCommand,
	survivorsOf,
	Verdict,
} from "./e2e-harness.ts";

const REPO_ROOT = resolve(import.meta.dir, "..");
const EXAMPLE = join(REPO_ROOT, "examples/native");
const CLI = join(REPO_ROOT, "src/cli/index.ts");
const CONFIG = join(EXAMPLE, "crust.config.ts");
const GENERATED = join(EXAMPLE, "extensions/generated");

/** The page's Rust answer: asked only after Zig resolved, so it is the later of the two. */
const RUST_ANSWER = /rustclock\.now \{[^}]*"flavor":"rust"\}/;
/** The Zig answer, already in the buffer when the Rust line arrives. */
const ZIG_ANSWER = /zigclock\.now \{[^}]*"flavor":"zig"\}/;

/** The runtime child and WebKit's web process, generously bounded. */
const DEV_TIMEOUT_MS = 45_000;

const SURVIVOR_PATTERNS = [CONFIG, "dev --dir examples/native"];

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
			`e2e-native: SKIP  this proof opens a macOS window and needs an Aqua session; ` +
				`running ${process.platform}/${process.arch}`,
		);
		return 1;
	}

	const verdict = new Verdict();
	for (const pattern of SURVIVOR_PATTERNS) await clearSurvivors(pattern);

	// ---- 1. compile both sources with the repo's own pipeline ------------------
	const build = await runCommand(["bun", "run", "scripts/native-extensions.ts"], REPO_ROOT);
	verdict.check(
		"compile",
		build.code === 0,
		build.code === 0
			? "scripts/native-extensions.ts exited 0"
			: `exit ${build.code} — ${lastLine(build.stderr) || lastLine(build.stdout) || "no output"}`,
	);
	for (const dylib of ["clock.dylib", "libclock.dylib"]) {
		const info = await stat(join(GENERATED, dylib)).catch(() => undefined);
		verdict.check(
			dylib,
			info !== undefined && info.size > 1024,
			info === undefined ? "missing" : `${info.size} bytes`,
		);
	}

	// ---- 2. a real dev run, and a page that reaches both dylibs ---------------
	const run = await probe({
		command: [CLI, "dev", "--dir", "examples/native"],
		cwd: REPO_ROOT,
		match: RUST_ANSWER,
		timeoutMs: DEV_TIMEOUT_MS,
	});

	verdict.check(
		"bridge rust",
		run.matched !== null,
		run.matched ??
			`no rustclock answer within ${DEV_TIMEOUT_MS / 1000} s — ` +
				(lastLine(run.stdout) || lastLine(run.stderr) || "crust dev printed nothing"),
	);
	verdict.check(
		"bridge zig",
		ZIG_ANSWER.test(run.stdout),
		ZIG_ANSWER.test(run.stdout) ? "zigclock answered first" : "no zigclock answer in the log",
	);
	verdict.check(
		"direct ffi",
		/direct zig\s+1\d{12}/.test(run.stdout) && /direct rust\s+1\d{12}/.test(run.stdout),
		"main.ts read the epoch from both dylibs before the window opened",
	);
	verdict.check(
		"loaded",
		/extensions\s+2 of 2 files loaded/.test(run.stdout),
		/extensions\s+2 of 2 files loaded/.test(run.stdout)
			? "both extension files loaded"
			: "an extension file failed to load — the runtime printed why above",
	);

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

	return verdict.report("e2e-native");
}

let code: number;
try {
	code = await main();
} catch (error) {
	for (const pattern of SURVIVOR_PATTERNS) {
		await clearSurvivors(pattern).catch(() => undefined);
	}
	console.log(`e2e-native: FAIL  ${error instanceof Error ? error.message : String(error)}`);
	code = 1;
} finally {
	await restoreFocus();
}
process.exit(code);
