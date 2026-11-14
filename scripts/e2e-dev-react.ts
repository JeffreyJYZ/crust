/**
 * E2E for `crust dev` with `dev.url` set: a React+Vite page served from another origin, its live token read from `.crust/dev.json`, and `invoke` answered across origins.
 * Cold start is the proof — Vite measured 0.66-1.08 s to listen and lost the race in 0 of 4 scratch runs before `dev.ts` waited for the URL; scaffold built by `crust init --react`, never copied, so it cannot drift. Phases in `dev-react/phases/`.
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { clearSurvivors, Verdict } from "./e2e-harness.ts";
import { spawnLive } from "./lib/live-run.ts";
import { CLI, GRACE_MS, REPO_ROOT } from "./dev-react/fixture.ts";
import { editPhase } from "./dev-react/phases/edit.ts";
import { scaffoldPhase } from "./dev-react/phases/scaffold.ts";
import { servePhase } from "./dev-react/phases/serve.ts";
import { stopPhase } from "./dev-react/phases/stop.ts";

async function main(): Promise<number> {
	if (process.platform !== "darwin") {
		console.log(
			`e2e-dev-react: SKIP  this proof opens a macOS window and needs an Aqua session; ` +
				`running ${process.platform}/${process.arch}`,
		);
		return 1;
	}

	const verdict = new Verdict();
	const scratch = await mkdtemp(join(tmpdir(), "crust-e2e-dev-react-"));
	try {
		return await proof(verdict, scratch);
	} finally {
		// The CLI (`dev --dir <scratch>`) and the runtime (`--config <scratch>/…`)
		// both name the scratch directory on their argv, so either is clearable by
		// path. The dev server does not — it runs as `bun --bun
		// ./node_modules/.bin/vite` with the project as its cwd — which is why the
		// survivor check also holds every child's pid: a `pgrep -f vite` would match
		// every Vite on the machine, and a bare path pattern would miss this one.
		await clearSurvivors(scratch).catch(() => undefined);
		await rm(scratch, { recursive: true, force: true }).catch(() => undefined);
	}
}

async function proof(verdict: Verdict, scratch: string): Promise<number> {
	if (!(await scaffoldPhase(verdict, scratch))) return verdict.report("e2e-dev-react");

	// ---- 3. No warm-up: the cold start is the point -----------------------
	// This used to run the dev server once and stop it, because `crust dev` created the
	// window before Vite listened and the page request went into a closed port. `dev` now
	// waits for the URL, so the fixture stays cold — pre-bundled dependencies would hide
	// exactly the race this file exists to catch.

	// ---- 4. `crust dev` starts the frontend, and the dev server answers ----
	const dev = spawnLive([CLI, "dev", "--dir", scratch], REPO_ROOT, { graceMs: GRACE_MS });
	try {
		const served = await servePhase(verdict, dev, scratch);
		await editPhase(verdict, dev, scratch, served.greeted);
		await stopPhase(verdict, dev, served.early, scratch);
	} finally {
		await dev.stop().catch(() => undefined);
	}

	return verdict.report("e2e-dev-react");
}

try {
	process.exit(await main());
} catch (error) {
	console.log(`e2e-dev-react: FAIL  ${error instanceof Error ? error.message : String(error)}`);
	process.exit(1);
}
