#!/usr/bin/env bun
/**
 * `crust dev` from a compiled binary — the path no other proof covers.
 *
 * `build-standalone.ts` proves a binary can start, scaffold and diagnose; `e2e-dev.ts`
 * proves the watcher from a checkout. The two things that only fail inside an executable
 * are both here:
 *
 *   1. the runtime child needs an interpreter, and a machine that only has crust has no
 *      `bun` on PATH — the binary re-executes itself with `BUN_BE_BUN=1` instead;
 *   2. the generated runner names the framework by absolute path, and `/$bunfs` is
 *      mounted in one process only, so a child must be handed the materialised copy.
 *
 * Both shapes are exercised: a single file (`crust dev app.tsx`) and a scaffolded
 * project (`crust dev --dir`). The interpreter case runs twice, once with Bun on PATH
 * and once with a deliberately bare one, because those are two different branches.
 *
 * Usage:
 *   bun run build:standalone && bun scripts/e2e-dev-binary.ts
 *   CRUST_BIN=./dist/crust bun scripts/e2e-dev-binary.ts
 *
 * Nothing is left running and every temporary directory is removed, including on
 * failure: the survivor patterns are checked after both runs, not only after the last.
 */
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { clearSurvivors, probe, survivorsOf, Verdict } from "./e2e-harness.ts";

const REPO_ROOT = resolve(import.meta.dir, "..");
const BIN = resolve(REPO_ROOT, process.env.CRUST_BIN ?? "dist/crust");

/** The window, the shim compile and WebKit's web process, generously bounded. */
const DEV_TIMEOUT_MS = 45_000;

/** The line the page's own `invoke` produces, printed by the framework's `info` command. */
const INFO = /info\s+app answered the page/;
/** The payload proving `echo` returned what the page sent. */
const ECHO = /echo\s+\{"from":"page","ok":true\}/;
/** The scaffold's page calls `greet`, and `main.ts` logs the answer. */
const GREET = /greet\s+hello crust \(page call answered\)/;
/** The scaffold's `ready` handler, so the project path proves a window too. */
const WINDOW = /window\s+open/;

const SINGLE_PAGE = `// No default export: this page owns the DOM and proves the round trip itself.
const reply = await window.crust.invoke("info", { from: "page" });
document.title = \`info:\${reply.app}:\${reply.single}\`;
document.body.textContent = \`reply \${JSON.stringify(reply)}\`;
await window.crust.invoke("echo", { from: "page", ok: true });
`;

/**
 * A minimal environment: enough for WebKit and for `tmpdir()` to agree with this
 * process, and a PATH with no Bun in it. `env -i` is used rather than a spawn option so
 * the proof does not depend on this harness's own environment leaking anything in.
 */
function bare(path: string): string[] {
	return [
		"/usr/bin/env",
		"-i",
		`PATH=${path}`,
		`HOME=${process.env.HOME ?? ""}`,
		`TMPDIR=${tmpdir()}`,
		BIN,
	];
}

/** The PATH a machine that installed crust alone has. */
const NO_BUN_PATH = "/usr/bin:/bin";

function lastLine(text: string): string {
	return (
		text
			.split("\n")
			.filter((row) => row.trim().length > 0)
			.at(-1)
			?.trim() ?? ""
	);
}

async function main(): Promise<number> {
	if (process.platform !== "darwin") {
		console.log(
			`e2e-dev-binary: SKIP  this proof opens a macOS window; running ${process.platform}/${process.arch}`,
		);
		return 1;
	}

	const verdict = new Verdict();
	const hasBinary = await Bun.file(BIN).exists();
	verdict.check(
		"binary",
		hasBinary,
		hasBinary ? `${BIN}` : `${BIN} is missing — run "bun run build:standalone" first`,
	);
	if (!hasBinary) return verdict.report("e2e-dev-binary");

	const version = Bun.spawnSync([...bare(NO_BUN_PATH), "--version"])
		.stdout.toString()
		.trim();
	const tree = join(tmpdir(), `crust-framework-${version}`);

	// The fallback interpreter exists at all: the binary, told to be Bun, answers as one.
	const beBun = Bun.spawnSync([
		"/usr/bin/env",
		"-i",
		`PATH=${NO_BUN_PATH}`,
		`BUN_BE_BUN=1`,
		BIN,
		"-e",
		"process.stdout.write(Bun.version)",
	]);
	verdict.check(
		"interpreter",
		beBun.exitCode === 0 && beBun.stdout.toString().trim().length > 0,
		beBun.exitCode === 0
			? `BUN_BE_BUN=1 ${basename(BIN)} answers as Bun ${beBun.stdout.toString().trim()}`
			: `BUN_BE_BUN=1 exited ${beBun.exitCode}: ${lastLine(beBun.stderr.toString()) || "no output"}`,
	);

	// `Bun.which` is what the CLI consults, so the empty answer is the premise of the
	// no-Bun run rather than an assumption about what PATH contains.
	const which = Bun.spawnSync([
		"/usr/bin/env",
		"-i",
		`PATH=${NO_BUN_PATH}`,
		"/usr/bin/which",
		"bun",
	]);
	verdict.check(
		"no bun on PATH",
		which.exitCode !== 0,
		which.exitCode !== 0
			? `${NO_BUN_PATH} has no bun, so dev must use the binary itself`
			: `bun is on ${NO_BUN_PATH}, so the fallback is not under test`,
	);

	const workspace = await mkdtemp(join(tmpdir(), "crust-e2e-dev-bin-"));
	const single = join(workspace, "single");
	const project = join(workspace, "project");
	const page = join(single, "app.js");
	await mkdir(single, { recursive: true });
	await writeFile(page, SINGLE_PAGE, "utf8");

	// Every process this script starts names one of these two paths on its own argv,
	// which is what makes "nothing survives" a real assertion.
	const patterns = [page, project];
	/** The runner directory a single-file `dev` writes into; checked, never cleared. */
	const RUNNER = join(tmpdir(), "crust-single-");
	for (const pattern of patterns) await clearSurvivors(pattern).catch(() => undefined);

	try {
		/**
		 * One windowed run, stopped by the same SIGTERM its own stop handler sees, then
		 * checked for the lines only a live page produces. The probe waits for the *last*
		 * of them, because stopping on the first would cut the run before the rest arrived.
		 */
		const run = async (
			label: string,
			command: string[],
			cwd: string,
			expect: readonly RegExp[],
		) => {
			const last = expect.at(-1);
			if (last === undefined) throw new Error(`${label}: no line to wait for`);
			if (process.env.CRUST_E2E_TRACE === "1")
				console.log(`trace ${label}: cwd=${cwd} cmd=${JSON.stringify(command)}`);
			const result = await probe({
				command,
				cwd,
				match: last,
				timeoutMs: DEV_TIMEOUT_MS,
			});
			const text = result.stdout;
			const failed = expect.filter((pattern) => !pattern.test(text));
			verdict.check(
				label,
				failed.length === 0,
				failed.length === 0
					? `${result.matched} (${((result.matchedMs ?? 0) / 1000).toFixed(2)} s)`
					: `missing ${failed.map(String).join(", ")} — ` +
							(lastLine(result.stdout) ||
								lastLine(result.stderr) ||
								"nothing printed"),
			);
			let clean = result.code === 0;
			if (!clean) {
				// A run that had to be killed at the deadline proves nothing about the stop
				// path, and saying so beats reporting only the first failing line.
				const why = result.timedOut
					? `did not answer within ${DEV_TIMEOUT_MS / 1000} s`
					: `exit ${result.code ?? "null"}${result.signal ? ` (${String(result.signal)})` : ""}`;
				console.log(`note  ${label}: ${why}`);
				clean = false;
			}
			verdict.check(
				`${label} exit`,
				clean,
				clean ? "exit 0 after SIGTERM to the process group" : "see the note above",
			);
		};

		await run("single, bun", [BIN, "dev", page], single, [INFO, ECHO]);
		await run("single, no bun", [...bare(NO_BUN_PATH), "dev", page], single, [INFO, ECHO]);

		// The runner the single-file path generated imports the framework by absolute
		// path, so a missing tree means the child resolved nothing. It is materialised by
		// the run above and keyed by version, so it exists here or the binary cannot dev.
		const treeExists = await Bun.file(join(tree, "src", "runtime.ts")).exists();
		verdict.check(
			"framework tree",
			treeExists,
			treeExists
				? `${tree} (readable from another process)`
				: `${tree} holds no src/runtime.ts`,
		);

		// 2. The project shape: `crust init`, then `crust dev --dir`. The scaffold's own
		// `crust` dependency is linked to the tree the binary extracted rather than
		// installed, because installing needs a package manager and this proof is about
		// running with none. The same realpath means the app module is one instance.
		const init = Bun.spawnSync([...bare(NO_BUN_PATH), "init", project], { cwd: workspace });
		const scaffolded = await Bun.file(join(project, "main.ts")).exists();
		verdict.check(
			"init",
			init.exitCode === 0 && scaffolded,
			init.exitCode === 0 && scaffolded
				? `${basename(project)} scaffolded by the binary`
				: `exited ${init.exitCode}: ${lastLine(init.stderr.toString())}`,
		);

		if (scaffolded && treeExists) {
			await mkdir(join(project, "node_modules"), { recursive: true });
			await symlink(tree, join(project, "node_modules", "crust"), "dir");
			await run("project, no bun", [...bare(NO_BUN_PATH), "dev", "--dir", project], project, [
				WINDOW,
				GREET,
			]);
		}

		// 3. Nothing survives: each probe signalled the process group rather than the parent
		// alone, so the CLI, its runtime child and WebKit's helpers all had to leave. The
		// runner directory is checked but never cleared — another lane could own one.
		const survivors: number[] = [];
		for (const pattern of [...patterns, RUNNER])
			survivors.push(...(await survivorsOf(pattern)));
		verdict.check(
			"no survivors",
			survivors.length === 0,
			survivors.length === 0
				? "no dev, runtime or page process remains"
				: `pid ${survivors.join(", ")} still running`,
		);
	} finally {
		for (const pattern of patterns) await clearSurvivors(pattern).catch(() => undefined);
		await rm(workspace, { recursive: true, force: true }).catch(() => undefined);
	}

	return verdict.report("e2e-dev-binary");
}

try {
	process.exit(await main());
} catch (error) {
	console.log(`e2e-dev-binary: FAIL  ${error instanceof Error ? error.message : String(error)}`);
	if (process.env.CRUST_E2E_TRACE === "1" && error instanceof Error) console.log(error.stack);
	process.exit(1);
}
