/**
 * E2E for `examples/dogear`, the widest surface here: page-called `fs`, the window title, a menu-bar item and AppKit's folder picker, all judged by the page's own `DOGEAR_SELFCHECK` lines after a real build launched with cwd `/`.
 * The false pass to avoid is matching `PASS` without reading step names — ten passing lines still exit 0 — so the expected names are asserted as a set, and the two panel steps pass as "sheet up and still pending". The example is copied and its `github:` crust pin rewritten to `file:<repo>` so the framework under test is this tree; `dogear/fixture.ts`.
 */

import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { clearSurvivors, Verdict } from "./e2e-harness.ts";
import { buildPhase } from "./dogear/phases/build.ts";
import { finishPhase } from "./dogear/phases/finish.ts";
import { runPhase } from "./dogear/phases/steps.ts";

async function main(): Promise<number> {
	if (process.platform !== "darwin") {
		console.log(
			`e2e-dogear: SKIP  this proof builds a macOS .app and needs an Aqua session; ` +
				`running ${process.platform}/${process.arch}`,
		);
		return 1;
	}

	const verdict = new Verdict();
	const scratch = await mkdtemp(join(tmpdir(), "crust-e2e-dogear-"));
	/** The notes folder the app creates; inside the scratch tree, so cleanup covers it. */
	const notes = join(scratch, "notes");
	let binary: string | undefined;
	try {
		binary = await proof(verdict, scratch, notes);
	} finally {
		// A leaked bundle carries the scratch path in its argv, so it is clearable,
		// and the tree goes either way — a throw is not a reason to leave both.
		if (binary !== undefined) await clearSurvivors(binary).catch(() => undefined);
		await rm(scratch, { recursive: true, force: true }).catch(() => undefined);
	}

	const gone = await stat(scratch)
		.then(() => false)
		.catch(() => true);
	verdict.check(
		"scratch gone",
		gone,
		gone
			? `removed ${scratch}, so the seeded notes folder went with it`
			: `${scratch} still exists`,
	);

	return verdict.report("e2e-dogear");
}

async function proof(
	verdict: Verdict,
	scratch: string,
	notes: string,
): Promise<string | undefined> {
	const built = await buildPhase(verdict, scratch);
	if (built === undefined) return undefined;

	// ---- 4. run it from `/`, as a launched bundle does ----------------------
	await clearSurvivors(built.binary);
	if (!built.runnable) return built.binary;

	const run = await runPhase(verdict, built.binary, notes);
	await finishPhase(verdict, run, built.binary, notes);

	return built.binary;
}

try {
	process.exit(await main());
} catch (error) {
	// A throw is still a verdict: the scratch tree is removed in `main`, and the
	// reason is printed rather than buried in a stack trace.
	console.log(`e2e-dogear: FAIL  ${error instanceof Error ? error.message : String(error)}`);
	process.exit(1);
}
