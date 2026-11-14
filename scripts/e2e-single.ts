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
 *   - the runtime compiles the shim parts at launch, so every
 *     windowed run needs an Aqua session and gets a hard deadline plus a
 *     `SIGTERM` to its process group; macOS ships no `timeout(1)`;
 *   - a page edit must not restart the runtime, so the dev run is followed by
 *     waiting for a *second* answer rather than by re-reading a log at the end.
 *
 * Usage:
 *   bun scripts/e2e-single.ts    # or `bun run e2e:single` once package.json defines it
 *
 * Each phase lives in `single/phases/` (dev, build, watch) and the fixture —
 * the page it writes, the lines its runtime prints, the paths under the scratch
 * directory — is `single/fixture.ts`. The order of the assertions is the order
 * a user meets them, so the phases run in that order and nowhere else.
 */

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { clearSurvivors, Verdict } from "./e2e-harness.ts";
import { pageSource, pathsOf } from "./single/fixture.ts";
import { buildPhase } from "./single/phases/build.ts";
import { devPhase } from "./single/phases/dev.ts";
import { watchPhase } from "./single/phases/watch.ts";

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
	const paths = pathsOf(scratch);
	await writeFile(paths.appFile, pageSource("one"), "utf8");

	await devPhase(verdict, scratch, paths);
	await buildPhase(verdict, scratch, paths);
	await watchPhase(verdict, scratch, paths);

	return verdict.report("e2e-single");
}

try {
	process.exit(await main());
} catch (error) {
	// A throw is still a verdict: the scratch directory is removed in `main`.
	console.log(`e2e-single: FAIL  ${error instanceof Error ? error.message : String(error)}`);
	process.exit(1);
}
