/**
 * The end-to-end proof for `examples/dogear` — the widest surface in this repo.
 *
 * Every other proof builds a project this suite writes itself. Dogear is a real
 * app: notes on disk through the `fs` plugin called from the page, the window
 * title tracking the open note, a menu-bar item with a menu, and AppKit's folder
 * picker. Until now the only thing that ran it was a human copying lines out of
 * its README, so any of those could rot without a gate noticing.
 *
 * The page already asserts its own surface: `DOGEAR_SELFCHECK=1` makes it run
 * eleven steps through `window.crust` and print `PASS`/`FAIL` per step plus a `done`
 * line through the backend's `log` command. This script does not re-derive those
 * steps — it builds the app, launches it the way a bundle is launched (cwd `/`),
 * and judges the page's own lines.
 *
 * The false pass this is built to avoid: matching `PASS` without reading the
 * step names. A step that stops running would leave ten PASS lines and still
 * exit 0, so the names are asserted exactly — each expected step once, nothing
 * extra, no duplicates — but as a set rather than a sequence: every step's line
 * reaches the backend as its own bridge message, so two can arrive in either
 * order even though the page awaited them in turn. The two panel steps are the
 * honest exception — no run completes a pick, so what passes is the sheet being
 * *up and still pending*, and those assertions say so rather than reading a
 * pending invoke as a choice.
 *
 * The example is copied to a scratch tree first, because two facts make the
 * in-repo directory the wrong thing to build: it has no `node_modules` (an
 * install there would rewrite the checkout's own state), and its `crust`
 * dependency is a `github:` pin — building it would embed the published
 * framework instead of the checkout under test. The copy rewrites exactly that
 * one dependency to `file:<repo>`, so the app code is byte-identical to the
 * example and the framework is this working tree.
 *
 * Usage:
 *   bun scripts/e2e-dogear.ts    # or `bun run e2e:dogear` once package.json names it
 *
 * The phases live in `dogear/phases/` — build, steps, finish — the page's own
 * line shapes are `dogear/report.ts`, and the copy is `dogear/fixture.ts`.
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
