/**
 * The last case of the single-file proof: an `.html` entry, which no bundler touches. Kept apart
 * from the run/harness body in `e2e-single.ts` so each file stays under the line cap without
 * dropping an assertion or a measured reason. The page's own inline module is the only witness:
 * the harness reads stdout, so the script renders the marker, writes the answer into the DOM and
 * echoes both back through `echo`, which the runtime logs.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { runCommand, Verdict } from "../e2e-harness.ts";
import { spawnLive } from "../lib/live-run.ts";
import { survivorsOfPids } from "../lib/pids.ts";
import { lastLine } from "../lib/text.ts";
import { CLI, DEV_TIMEOUT_MS, STEP_TIMEOUT_MS } from "./fixture.ts";

/** The marker the html page renders and then reads back out of its own DOM. */
const HTML_MARKER = "single-file html";
/** The dev log line naming a copied document instead of a bundle. */
const HTML_MODE = /mode\s+static html \(rebuilt on every change\)/;
/** `INFO` names the tsx fixture's app; this page's app name is `page`. */
const HTML_INFO = /info\s+page answered the page/;
/** The page's own echo: what it rendered, and what `info` answered. */
const HTML_ECHO = /echo\s+\{.*"marker":"single-file html".*"answer":"page single=true"/;

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

export async function htmlPhase(verdict: Verdict, scratch: string): Promise<void> {
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
