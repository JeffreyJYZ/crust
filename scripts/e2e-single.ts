/**
 * E2E for the shape a newcomer meets first: `crust dev app.tsx` opens a window and answers the page's `invoke("info")`, `crust build app.tsx` runs from `/` with no project directory, and an edit rebuilds in place while a syntax error leaves the last good bundle untouched.
 * A page edit must not restart the runtime, so the watch phase waits for a *second* answer rather than re-reading a log at the end. Phases in `single/phases/`, the `.html` case in `single/html-phase.ts`, fixture in `single/fixture.ts`; the split keeps this file under the line cap without dropping an assertion.
 */

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { clearSurvivors, guardFocus, restoreFocus, Verdict } from "./e2e-harness.ts";
import { pageSource, pathsOf } from "./single/fixture.ts";
import { htmlPhase } from "./single/html-phase.ts";
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
	// Armed before any dev/build phase opens a window. Its decision is what the `finally`
	// restores; a Ctrl-C runs no `finally`, so the guard also restores on `exit` and the
	// three signals.
	const frontmost = guardFocus();

	// The scratch directory is created inside the `try`, so a full temp directory cannot
	// throw between the capture above and the restore below.
	let scratch: string | undefined;
	try {
		// This run's project: it holds `app.tsx`, the dev bundle and `dist/`. A fresh temp
		// directory also means no `crust.config.ts` exists above the file, which single-file
		// mode refuses to guess around.
		scratch = await mkdtemp(join(tmpdir(), "crust-e2e-single-"));
		return await proof(verdict, scratch);
	} finally {
		if (scratch !== undefined) {
			// A leaked built app carries this run's scratch path in its argv, so it can
			// be cleared by path; a dev process is stopped by pid inside its phase.
			await clearSurvivors(scratch).catch(() => undefined);
			await rm(scratch, { recursive: true, force: true }).catch(() => undefined);
		}
		// Last, so a red run does not leave the human looking at the window it opened.
		await restoreFocus(frontmost);
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

try {
	process.exit(await main());
} catch (error) {
	// A throw is still a verdict: the scratch directory is removed in `main`.
	console.log(`e2e-single: FAIL  ${error instanceof Error ? error.message : String(error)}`);
	process.exit(1);
}
