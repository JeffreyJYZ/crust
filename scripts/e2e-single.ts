/**
 * The end-to-end proof for the mode a newcomer tries first: one file, no config.
 *
 * `e2e.ts` and `e2e-notes.ts` prove a project; this one proves `crust dev app.tsx`
 * and `crust build app.tsx`, in the order a user meets them. Until now both were
 * exercised by hand, so the gate could stay green while the shortest path to a
 * window was broken.
 *
 * Three phases, each through the real command:
 *
 *   1. `crust dev app.tsx` — the generated runner opens a window, the bridge
 *      serves the page from `.crust/single`, and the page's own
 *      `window.crust.invoke("info")` is answered (the backend logs the line).
 *   2. `crust build app.tsx` — the bundle is assembled and ad-hoc signed, then
 *      the binary inside it is launched with `/` as its working directory,
 *      because that is the cwd a bundle gets from LaunchServices. A single-file
 *      app must answer from its embedded page with no project directory to read.
 *   3. Rebuild on save — editing the file must replace the served bundle and
 *      move the reload marker without restarting the runtime, and a syntax error
 *      must leave the last good bundle exactly where it was.
 *
 * The app is launched directly — never `open`, which routes through
 * LaunchServices and Gatekeeper and would hide which process ran.
 *
 * Two facts this script is built around:
 *
 *   - the runtime compiles `src/platform/darwin/shim.c` at launch, so every
 *     windowed run needs an Aqua session and gets a hard deadline plus a
 *     `SIGTERM` to its process group; macOS ships no `timeout(1)`;
 *   - a page edit must not restart the runtime, so the dev run is followed by
 *     waiting for a *second* answer rather than by re-reading a log at the end.
 *
 * Usage:
 *   bun scripts/e2e-single.ts    # or `bun run e2e:single` once package.json defines it
 */

import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { clearSurvivors, probe, runCommand, survivorsOf, Verdict } from "./e2e-harness.ts";

const REPO_ROOT = resolve(import.meta.dir, "..");
const CLI = join(REPO_ROOT, "src/cli/index.ts");

/** The file the user names; its basename is also the app name and bundle name. */
const APP_FILE = "app.tsx";
const BUNDLE_NAME = "app.app";

/**
 * `registerSingleCommands` logs this once the page's `invoke("info")` has been
 * answered. Matching the whole sentence, not the word "info", keeps the
 * assertion about the round trip rather than about output existing.
 */
const INFO = /info\s+app answered the page/;
/** The dev runtime printing the address it serves the page from. */
const BRIDGE = /bridge\s+http:\/\//;
/** A page edit rebuilt and the window was told to reload. */
const REBUILT = /page\s+rebuilt/;
/** A rebuild failed; the previous page is untouched. */
const BUILD_FAILED = /page\s+build failed/;
/** The runtime was restarted instead of reloaded — the thing phase 3 forbids. */
const RESTARTED = /restart\s+backend changed/;

/** Watcher startup, the shim compile and WebKit's web process. Measured ~2 s. */
const DEV_TIMEOUT_MS = 30_000;
/** One save, its rebuild and the page's poll interval (400 ms) — measured < 1 s. */
const STEP_TIMEOUT_MS = 15_000;
/** A window plus WebKit's web process, measured ~1 s. */
const APP_TIMEOUT_MS = 15_000;

/** How long a signalled process gets before SIGKILL. */
const GRACE_MS = 5000;

type Stream = "out" | "err";

function delay(ms: number): Promise<"delay"> {
	return new Promise((resolve) => setTimeout(() => resolve("delay"), ms));
}

/** The last non-empty line of a captured stream, for a failure detail. */
function lastLine(text: string): string {
	const lines = text.split("\n").filter((line) => line.trim().length > 0);
	return lines.at(-1)?.trim() ?? "";
}

function seconds(ms: number | null): string {
	return ms === null ? "no exit" : `${(ms / 1000).toFixed(2)} s`;
}

/** Mark every listed assertion failed when an earlier step made them unknowable. */
function skip(verdict: Verdict, names: string[], why: string): void {
	for (const name of names) verdict.check(name, false, why);
}

/** The whole line holding the `count`th (1-based) match of `pattern`. */
function nthLine(text: string, pattern: RegExp, count: number): string | null {
	const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
	const found = [...text.matchAll(new RegExp(pattern.source, flags))][count - 1];
	if (!found || found.index === undefined) return null;
	const start = text.lastIndexOf("\n", found.index) + 1;
	const end = text.indexOf("\n", found.index);
	return text.slice(start, end === -1 ? undefined : end).trim();
}

/** Every match count of `pattern` in `text`, for "did it happen twice" checks. */
function count(text: string, pattern: RegExp): number {
	const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
	return [...text.matchAll(new RegExp(pattern.source, flags))].length;
}

/** Signal the child's process group, falling back to the child alone. */
function signalGroup(pid: number, signal: NodeJS.Signals): void {
	try {
		process.kill(-pid, signal);
		return;
	} catch {
		// No group (already gone, or not a leader); aim at the child itself.
	}
	try {
		process.kill(pid, signal);
	} catch {
		// Nothing left to signal.
	}
}

/** Whether any of `pids` is still in the process table, after a bounded settle. */
async function survivors(pids: readonly number[], settleMs = 2000): Promise<number[]> {
	const deadline = performance.now() + settleMs;
	for (;;) {
		const alive = pids.filter((pid) => {
			try {
				process.kill(pid, 0);
				return true;
			} catch {
				return false;
			}
		});
		if (alive.length === 0 || performance.now() >= deadline) return alive;
		await delay(50);
	}
}

/** A running child whose whole output is kept, so several lines can be waited for. */
interface LiveRun {
	readonly pid: number;
	text(stream: Stream): string;
	wait(stream: Stream, pattern: RegExp, count: number, timeoutMs: number): Promise<string | null>;
	alive(): boolean;
	/** Direct children right now — the runtime `crust dev` spawned. */
	children(): Promise<number[]>;
	/** SIGTERM the group, then SIGKILL after the grace period. Idempotent. */
	stop(): Promise<number | null>;
}

/**
 * Spawn a process that stays up across assertions.
 *
 * `e2e-harness.ts`'s `probe` stops the child the moment its line appears, which
 * is the right shape for one answer. A rebuild proof needs the same process
 * before and after an edit, so this keeps it alive and searches its whole log.
 *
 * The child is its own process group (`detached`), because `crust dev` owns a
 * runtime child: signalling only the CLI would leave a window behind.
 */
function spawnLive(command: string[], cwd: string): LiveRun {
	const child = Bun.spawn({
		cmd: command,
		cwd,
		stdin: "ignore",
		stdout: "pipe",
		stderr: "pipe",
		detached: true,
	});

	const streams: Record<Stream, string> = { out: "", err: "" };
	let code: number | null = null;
	let settled = false;

	const exited = child.exited.then((status) => {
		settled = true;
		code = status;
		return status;
	});
	exited.catch(() => undefined);

	// One decoder per stream: a chunk boundary can split a character, and sharing
	// one decoder across two interleaved streams would corrupt both.
	const outDecoder = new TextDecoder();
	void (async () => {
		for await (const chunk of child.stdout)
			streams.out += outDecoder.decode(chunk, { stream: true });
	})().catch(() => undefined);
	const errDecoder = new TextDecoder();
	void (async () => {
		for await (const chunk of child.stderr)
			streams.err += errDecoder.decode(chunk, { stream: true });
	})().catch(() => undefined);

	const text = (stream: Stream): string => streams[stream];

	async function wait(
		stream: Stream,
		pattern: RegExp,
		which: number,
		timeoutMs: number,
	): Promise<string | null> {
		const deadline = performance.now() + timeoutMs;
		for (;;) {
			const found = nthLine(streams[stream], pattern, which);
			if (found !== null) return found;
			// A child that exited will never print the line; report that now rather
			// than burning the whole deadline on a process that is already gone.
			if (settled || performance.now() >= deadline) return null;
			await delay(50);
		}
	}

	const alive = (): boolean => {
		try {
			process.kill(child.pid, 0);
			return true;
		} catch {
			return false;
		}
	};

	async function children(): Promise<number[]> {
		// pgrep exits 1 when there are none; that is an empty answer, not an error.
		const { stdout } = await runCommand(["pgrep", "-P", String(child.pid)], cwd);
		return stdout
			.split("\n")
			.map((line) => line.trim())
			.filter((line) => /^\d+$/.test(line))
			.map((line) => Number.parseInt(line, 10));
	}

	let stopping: Promise<number | null> | undefined;
	async function stop(): Promise<number | null> {
		signalGroup(child.pid, "SIGTERM");
		await Promise.race([exited, delay(GRACE_MS)]);
		if (!settled) {
			// Still alive after the grace period: it answers no SIGTERM.
			signalGroup(child.pid, "SIGKILL");
			await Promise.race([exited, delay(2000)]);
		}
		return code;
	}

	return {
		pid: child.pid,
		text,
		wait,
		alive,
		children,
		stop: () => {
			stopping ??= stop();
			return stopping;
		},
	};
}

/**
 * The page under test. No `export default`, so crust loads it for its own side
 * effects and no React is needed: the file owns the document and calls the one
 * command the single-file mode registers. `marker` is text that reaches the
 * bundled `page.js`, so an edit is visible in the served bytes and not only in
 * the source.
 */
function pageSource(marker: string): string {
	return [
		"// Written by scripts/e2e-single.ts, not by crust. No default export:",
		"// this module owns the document and proves the bridge by calling it.",
		`document.body.textContent = "single-file ${marker}";`,
		'window.crust.invoke("info");',
		"",
	].join("\n");
}

/** A file a user could plausibly leave half-typed: Bun.build throws on it. */
function brokenSource(): string {
	return ["// half-typed on purpose", "document.body.textContent = ;", ""].join("\n");
}

/** The bytes of a file, as a digest — the cheapest "did this change" proof. */
async function digest(path: string): Promise<string> {
	const bytes = await Bun.file(path)
		.arrayBuffer()
		.catch(() => undefined);
	if (bytes === undefined) return "missing";
	return createHash("sha256").update(new Uint8Array(bytes)).digest("hex").slice(0, 12);
}

async function main(): Promise<number> {
	if (process.platform !== "darwin") {
		console.log(
			`e2e-single: SKIP  this proof opens macOS windows and needs an Aqua session; ` +
				`running ${process.platform}/${process.arch}`,
		);
		return 1;
	}

	const verdict = new Verdict();

	// The scratch directory is this run's project: it holds `app.tsx`, the dev
	// bundle and `dist/`. A fresh temp directory also means no `crust.config.ts`
	// exists above the file, which single-file mode refuses to guess around.
	const scratch = await mkdtemp(join(tmpdir(), "crust-e2e-single-"));
	try {
		return await proof(verdict, scratch);
	} finally {
		// A leaked built app carries this run's scratch path in its argv, so it can
		// be cleared by path; a dev process is stopped by pid inside its phase.
		await clearSurvivors(scratch).catch(() => undefined);
		await rm(scratch, { recursive: true, force: true }).catch(() => undefined);
	}
}

async function proof(verdict: Verdict, scratch: string): Promise<number> {
	const appFile = join(scratch, APP_FILE);
	const bundle = join(scratch, "dist", BUNDLE_NAME);
	const binary = join(bundle, "Contents", "MacOS", "crust-app");
	const devDir = join(scratch, ".crust", "single");
	const devPage = join(devDir, "page.js");
	const reloadMarker = join(devDir, "__crust_reload.txt");

	await writeFile(appFile, pageSource("one"), "utf8");

	// ---- 1. `crust dev app.tsx` answers the page's invoke -------------------
	const dev = spawnLive([CLI, "dev", APP_FILE], scratch);
	try {
		const answer = await dev.wait("out", INFO, 1, DEV_TIMEOUT_MS);
		verdict.check(
			"dev info",
			answer !== null,
			answer ??
				`no info answer within ${DEV_TIMEOUT_MS / 1000} s — ` +
					(lastLine(dev.text("out")) ||
						lastLine(dev.text("err")) ||
						"crust dev printed nothing"),
		);

		const served = await stat(join(devDir, "index.html"))
			.then((entry) => entry.isFile())
			.catch(() => false);
		const module = await stat(devPage)
			.then((entry) => entry.isFile())
			.catch(() => false);
		verdict.check(
			"dev bundle",
			served && module,
			served && module
				? `.crust/single/{index.html,page.js} written by the dev build`
				: `the dev build never wrote .crust/single — index.html ${served ? "ok" : "missing"}, ` +
						`page.js ${module ? "ok" : "missing"}`,
		);

		// The runtime is a child of the CLI, so both have to be gone before the
		// assertion means anything; capture them while the parent still exists.
		const runtime = await dev.children();
		const code = await dev.stop();
		const started = dev.pid;
		verdict.check(
			"dev stop",
			code === 0,
			code === 0
				? `crust dev exited 0 on SIGTERM (pid ${started})`
				: `crust dev exited ${code ?? "null"} after the process group was signalled`,
		);

		// pid-based, not `pgrep -f <scratch>`: the CLI's argv holds the relative
		// `app.tsx`, so a path pattern would match nothing and pass for free.
		const left = await survivors([started, ...runtime]);
		verdict.check(
			"dev clean",
			left.length === 0,
			left.length === 0
				? `no dev process or runtime child remains (${runtime.length} child checked)`
				: `still running: pid ${left.join(", ")}`,
		);
	} finally {
		await dev.stop().catch(() => undefined);
	}

	// ---- 2. `crust build app.tsx` makes a launchable .app -------------------
	const build = await runCommand([CLI, "build", APP_FILE], scratch);
	const namedBundle = build.stdout.includes(bundle);
	const built = build.code === 0 && namedBundle;
	verdict.check(
		"build",
		built,
		build.code !== 0
			? `crust build exited ${build.code} — ${lastLine(build.stderr) || lastLine(build.stdout) || "no output"}`
			: namedBundle
				? "crust build exited 0 and named the bundle"
				: `crust build exited 0 but never printed ${bundle}`,
	);

	if (!built) {
		if (build.code !== 0) console.log(build.stdout + build.stderr);
		skip(
			verdict,
			["bundle", "binary", "codesign", "app info", "app stop", "app clean"],
			"not checked — crust build failed",
		);
	} else {
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

		const signature = await runCommand(["codesign", "-dv", "--verbose=4", bundle], REPO_ROOT);
		const signatureText = `${signature.stderr}${signature.stdout}`;
		const adhoc = signature.code === 0 && /^Signature=adhoc$/m.test(signatureText);
		verdict.check(
			"codesign",
			adhoc,
			adhoc
				? "codesign -dv reports Signature=adhoc"
				: lastLine(signatureText) || "codesign -dv printed nothing",
		);

		// `/` is the cwd a bundle is launched with, and a single-file build has no
		// project directory to fall back to: the page must come from the binary's
		// own asset table. Anything written relative would throw here, exactly as
		// it would on a recipient's machine.
		const run = await probe({
			command: [binary],
			cwd: "/",
			match: INFO,
			timeoutMs: APP_TIMEOUT_MS,
		});
		verdict.check(
			"app info",
			run.matched !== null,
			run.matched ??
				`no info answer within ${APP_TIMEOUT_MS / 1000} s with cwd / — ` +
					(lastLine(run.stdout) || lastLine(run.stderr) || "the binary printed nothing"),
		);

		const cleanExit = run.code === 0 && !run.timedOut;
		verdict.check(
			"app stop",
			cleanExit,
			cleanExit
				? `the built app exited 0 after ${seconds(run.exitMs)}`
				: `exit ${run.code ?? "null"}${run.signal ? ` (${String(run.signal)})` : ""}` +
						`${run.timedOut ? ` after the ${APP_TIMEOUT_MS / 1000} s deadline` : ""}`,
		);

		const remaining = await survivorsOf(binary);
		verdict.check(
			"app clean",
			remaining.length === 0,
			remaining.length === 0
				? "no process matches the built binary path"
				: `pid ${remaining.join(", ")} still running`,
		);
	}

	// ---- 3. A save rebuilds the page without restarting the runtime --------
	await writeFile(appFile, pageSource("one"), "utf8");
	const watch = spawnLive([CLI, "dev", APP_FILE], scratch);
	try {
		const first = await watch.wait("out", INFO, 1, DEV_TIMEOUT_MS);
		if (first === null) {
			skip(
				verdict,
				[
					"save marker",
					"save answer",
					"no restart",
					"error reports",
					"error keeps",
					"error alive",
					"reload stop",
					"reload clean",
				],
				`not checked — the second crust dev never answered: ${lastLine(watch.text("out")) || "no output"}`,
			);
			await watch.stop().catch(() => undefined);
			return verdict.report("e2e-single");
		}

		const markerBefore = (await readFile(reloadMarker, "utf8").catch(() => "")).trim();
		const pageBefore = await digest(devPage);

		// A real code change, not a comment: comments are dropped by the transpiler,
		// so they would leave the served bytes identical and prove nothing.
		await writeFile(appFile, pageSource("two"), "utf8");
		const rebuilt = await watch.wait("out", REBUILT, 1, STEP_TIMEOUT_MS);
		const second = await watch.wait("out", INFO, 2, STEP_TIMEOUT_MS);

		const markerAfter = (await readFile(reloadMarker, "utf8").catch(() => "")).trim();
		const pageAfter = await digest(devPage);
		const markerMoved = markerBefore.length > 0 && markerAfter !== markerBefore;
		const pageMoved = pageBefore !== pageAfter;

		verdict.check(
			"save marker",
			markerMoved && pageMoved,
			markerMoved && pageMoved
				? `the served page moved ${pageBefore} -> ${pageAfter}, ` +
						`__crust_reload.txt ${markerBefore} -> ${markerAfter}`
				: !markerMoved
					? `__crust_reload.txt did not move from ${markerBefore || "missing"} after a save`
					: `the served page never changed (page.js still ${pageBefore})`,
		);

		verdict.check(
			"save answer",
			rebuilt !== null && second !== null,
			rebuilt !== null && second !== null
				? "the rebuilt page ran again in the same window and answered its invoke"
				: rebuilt === null
					? `no rebuild line within ${STEP_TIMEOUT_MS / 1000} s — ${lastLine(watch.text("out"))}`
					: "the window never reloaded: no second info answer after the save",
		);

		// A restart would start a second runtime and print a second bridge address;
		// the single-file watcher only rebuilds the page, so one bridge line is the
		// whole proof that the process survived the save.
		const bridges = count(watch.text("out"), BRIDGE);
		const restarted = RESTARTED.test(watch.text("out"));
		verdict.check(
			"no restart",
			bridges === 1 && !restarted,
			bridges === 1 && !restarted
				? "one bridge line across the save — the runtime was never restarted"
				: restarted
					? "the runtime restarted for a page edit"
					: `${bridges} bridge lines — the runtime started more than once`,
		);

		// A half-typed file is the failure a user meets by accident. It must be
		// reported and must not touch the bundle already on disk.
		await writeFile(appFile, brokenSource(), "utf8");
		const failed = await watch.wait("err", BUILD_FAILED, 1, STEP_TIMEOUT_MS);
		const pageAfterError = await digest(devPage);
		const markerAfterError = (await readFile(reloadMarker, "utf8").catch(() => "")).trim();

		verdict.check(
			"error reports",
			failed !== null,
			failed ??
				`no build-failure line within ${STEP_TIMEOUT_MS / 1000} s — ` +
					(lastLine(watch.text("err")) || "nothing on stderr"),
		);
		verdict.check(
			"error keeps",
			pageAfterError === pageAfter && markerAfterError === markerAfter,
			pageAfterError === pageAfter && markerAfterError === markerAfter
				? `page.js (${pageAfterError}) and the marker are the last good build`
				: `a failed build changed the page: page.js ${pageAfter} -> ${pageAfterError}, ` +
						`marker ${markerAfter} -> ${markerAfterError}`,
		);
		verdict.check(
			"error alive",
			watch.alive(),
			watch.alive()
				? "the window's runtime is still running after the bad save"
				: "the runtime died on a syntax error in the page",
		);

		const runtime = await watch.children();
		const code = await watch.stop();
		verdict.check(
			"reload stop",
			code === 0,
			code === 0
				? "crust dev exited 0 on SIGTERM after two rebuilds"
				: `crust dev exited ${code ?? "null"} instead of stopping cleanly`,
		);

		const left = await survivors([watch.pid, ...runtime]);
		verdict.check(
			"reload clean",
			left.length === 0,
			left.length === 0
				? `no dev process or runtime child remains (${runtime.length} child checked)`
				: `still running: pid ${left.join(", ")}`,
		);
	} finally {
		await watch.stop().catch(() => undefined);
	}

	return verdict.report("e2e-single");
}

try {
	process.exit(await main());
} catch (error) {
	// A throw is still a verdict: the scratch directory is removed in `main`.
	console.log(`e2e-single: FAIL  ${error instanceof Error ? error.message : String(error)}`);
	process.exit(1);
}
