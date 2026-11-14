/**
 * E2E for the shape a newcomer meets first: `crust dev app.tsx` opens a window and answers the page's `invoke("info")`, `crust build app.tsx` runs from `/` with no project directory, and an edit rebuilds in place while a syntax error leaves the last good bundle untouched.
 * A page edit must not restart the runtime, so the watch phase waits for a *second* answer rather than re-reading a log at the end. Phases in `single/phases/`, fixture in `single/fixture.ts`.
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
