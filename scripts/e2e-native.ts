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
import { pgrepLiteral } from "../src/packaging/extension-pattern.ts";
import { dylibSuffix } from "../src/packaging/extension-tools.ts";
import {
	clearSurvivors,
	guardFocus,
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

/**
 * `pgrep -f` takes an extended regular expression, so a repo path carrying `.`, `(`, `[` or `+` either
 * over-matches unrelated processes or misses the one it was given. `CONFIG` is absolute and already
 * contains dots, so every pattern goes through `pgrepLiteral` before it reaches the harness.
 */
const SURVIVOR_PATTERNS = [pgrepLiteral(CONFIG), pgrepLiteral("dev --dir examples/native")];

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
	for (const dylib of [`clock${dylibSuffix()}`, `libclock${dylibSuffix()}`]) {
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
	// Nothing here measures ordering: the page logs both epochs, and the window is opened by
	// the runtime before any page script runs. Only the two printed epochs are asserted.
	const directZig = /direct zig\s+1\d{12}/.test(run.stdout);
	const directRust = /direct rust\s+1\d{12}/.test(run.stdout);
	const missingDirect = [!directZig && "zig", !directRust && "rust"].filter(
		(name): name is string => typeof name === "string",
	);
	verdict.check(
		"direct ffi",
		directZig && directRust,
		directZig && directRust
			? "main.ts printed a direct epoch from both dylibs"
			: `main.ts printed no direct epoch from ${missingDirect.join(" or ")}`,
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

// Armed before `main` compiles and launches the app. Its decision is what the `finally`
// restores; a Ctrl-C runs no `finally`, so the guard also restores on `exit` and the
// three signals.
const frontmost = guardFocus();
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
	await restoreFocus(frontmost);
}
process.exit(code);
