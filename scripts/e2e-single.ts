/**
 * E2E for the shape a newcomer meets first: `crust dev app.tsx` opens a window and answers the page's `invoke("info")`, `crust build app.tsx` runs from `/` with no project directory, and an edit rebuilds in place while a syntax error leaves the last good bundle untouched.
 * A page edit must not restart the runtime, so the watch phase waits for a *second* answer rather than re-reading a log at the end. Phases in `single/phases/`, fixture in `single/fixture.ts`; the last case is an `.html` entry, which no bundler touches.
 */

import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { clearSurvivors, restoreFocus, runCommand, Verdict } from "./e2e-harness.ts";
import { spawnLive } from "./lib/live-run.ts";
import { survivorsOfPids } from "./lib/pids.ts";
import { lastLine } from "./lib/text.ts";
import { CLI, DEV_TIMEOUT_MS, pageSource, pathsOf, STEP_TIMEOUT_MS } from "./single/fixture.ts";
import { buildPhase } from "./single/phases/build.ts";
import { devPhase } from "./single/phases/dev.ts";
import { watchPhase } from "./single/phases/watch.ts";

/** The marker the html page renders and then reads back out of its own DOM. */
const HTML_MARKER = "single-file html";
/** The dev log line naming a copied document instead of a bundle. */
const HTML_MODE = /mode\s+static html \(rebuilt on every change\)/;
/** `INFO` names the tsx fixture's app; this page's app name is `page`. */
const HTML_INFO = /info\s+page answered the page/;
/** The page's own echo: what it rendered, and what `info` answered. */
const HTML_ECHO = /echo\s+\{.*"marker":"single-file html".*"answer":"page single=true"/;

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
		// Last, so a red run does not leave the human looking at the window it opened.
		await restoreFocus();
	}
}

async function proof(verdict: Verdict, scratch: string): Promise<number> {
	const paths = pathsOf(scratch);
	await writeFile(paths.appFile, pageSource("one"), "utf8");

	await devPhase(verdict, scratch, paths);
	await buildPhase(verdict, scratch, paths);
	await watchPhase(verdict, scratch, paths);
	await htmlPhase(verdict, scratch);

	return verdict.report("e2e-single");
}

/**
 * The page under test. Its own inline module is the only witness: the harness
 * reads stdout, so the script renders the marker, writes the answer into the DOM
 * and echoes both back through `echo`, which the runtime logs.
 */
function htmlSource(): string {
	return [
		"<!doctype html>",
		"<html>",
		'<head><meta charset="utf-8" /><title>page</title></head>',
		"<body>",
		`\t<p id="marker">${HTML_MARKER}</p>`,
		'\t<p id="answer">waiting</p>',
		'\t<script type="module">',
		'\t\tconst answer = await window.crust.invoke("info");',
		"\t\tconst shown = `${answer.app} single=${answer.single}`;",
		'\t\tdocument.getElementById("answer").textContent = shown;',
		'\t\tawait window.crust.invoke("echo", {',
		'\t\t\tmarker: document.getElementById("marker").textContent,',
		"\t\t\tanswer: shown,",
		"\t\t});",
		"\t</script>",
		"</body>",
		"</html>",
		"",
	].join("\n");
}

async function htmlPhase(verdict: Verdict, scratch: string): Promise<void> {
	// Its own directory: an `.html` build writes `dist/single/index.html`, which
	// would otherwise overwrite the bundle the tsx phases assert against.
	const dir = join(scratch, "html");
	await mkdir(dir, { recursive: true });
	const source = htmlSource();
	await writeFile(join(dir, "page.html"), source, "utf8");

	const dev = spawnLive([CLI, "dev", "page.html"], dir);
	try {
		const answer = await dev.wait("out", HTML_INFO, 1, DEV_TIMEOUT_MS);
		verdict.check(
			"html info",
			answer !== null,
			answer ??
				`no info answer within ${DEV_TIMEOUT_MS / 1000} s — ` +
					(lastLine(dev.text("out")) ||
						lastLine(dev.text("err")) ||
						"crust dev printed nothing"),
		);

		const echo = await dev.wait("out", HTML_ECHO, 1, STEP_TIMEOUT_MS);
		verdict.check(
			"html window",
			echo !== null,
			echo ??
				`the page never echoed the marker and the answer within ${STEP_TIMEOUT_MS / 1000} s — ` +
					(lastLine(dev.text("out")) || "nothing on stdout"),
		);

		const mode = HTML_MODE.test(dev.text("out"));
		verdict.check(
			"html mode",
			mode,
			mode
				? "crust dev logged the static html mode instead of a bundle name"
				: `no "mode  static html" line — ${lastLine(dev.text("out")) || "no output"}`,
		);

		const copy = await readFile(join(dir, ".crust", "single", "index.html"), "utf8").catch(
			() => "",
		);
		const identical = copy === source;
		verdict.check(
			"html copy",
			identical,
			identical
				? `.crust/single/index.html is byte-identical to page.html (${source.length} bytes)`
				: `the dev copy differs from the source (${copy.length} vs ${source.length} bytes)`,
		);

		// The runtime is a child of the CLI, so both have to be gone before the
		// assertion means anything; capture them while the parent still exists.
		const runtime = await dev.children();
		const code = await dev.stop();
		const started = dev.pid;
		verdict.check(
			"html stop",
			code === 0,
			code === 0
				? `crust dev exited 0 on SIGTERM (pid ${started})`
				: `crust dev exited ${code ?? "null"} after the process group was signalled`,
		);

		const left = await survivorsOfPids([started, ...runtime]);
		verdict.check(
			"html clean",
			left.length === 0,
			left.length === 0
				? `no dev process or runtime child remains (${runtime.length} child checked)`
				: `still running: pid ${left.join(", ")}`,
		);
	} finally {
		await dev.stop().catch(() => undefined);
	}

	const built = join(dir, "dist", "single", "index.html");
	const build = await runCommand([CLI, "build", "page.html"], dir);
	const named = build.stdout.includes(built);
	verdict.check(
		"html build",
		build.code === 0 && named,
		build.code !== 0
			? `crust build exited ${build.code} — ${lastLine(build.stderr) || lastLine(build.stdout) || "no output"}`
			: named
				? "crust build exited 0 and named dist/single/index.html"
				: `crust build exited 0 but never printed ${built}`,
	);

	const emitted = await readFile(built, "utf8").catch(() => "");
	const same = emitted === source;
	verdict.check(
		"html dist",
		same,
		same
			? `dist/single/index.html is byte-identical to page.html (${source.length} bytes)`
			: `the build copy differs from the source (${emitted.length} vs ${source.length} bytes)`,
	);
}

try {
	process.exit(await main());
} catch (error) {
	// A throw is still a verdict: the scratch directory is removed in `main`.
	console.log(`e2e-single: FAIL  ${error instanceof Error ? error.message : String(error)}`);
	process.exit(1);
}
