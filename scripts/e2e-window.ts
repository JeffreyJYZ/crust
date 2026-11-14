/**
 * The end-to-end proof for `crust:window` — the surface a user touches first.
 *
 * `window.test.ts` proves the plugin against fakes: every command resolves a
 * value, an unknown label is a typed failure, a platform with no adapter says
 * `not-implemented`. None of that proves the adapter, the AppKit window behind
 * it, or what a page actually receives. This script does, through the real path:
 * a project is written to a scratch directory, `crust build` compiles and
 * ad-hoc signs it, and the binary inside the bundle is launched directly — never
 * `open`, which routes through LaunchServices and hides which process ran.
 *
 * The app has two windows, so "a different label" is a real second window and
 * not the same one under another name. `other` runs the driver page and `main`
 * is the spare: `create` reusing a closed label needs the platform to drop its
 * stale entry, and that is proved on `main` while the driver stays alive. The
 * page calls every command through `window.crust.invoke` and reports each answer
 * to the backend, which prints it: one stream then holds the page's observables
 * and this process's own lines, and the count of those report lines is an
 * assertion — a page that never ran cannot pass by exiting 0 with an empty log.
 *
 * What the page sees is asserted as measured, not as intended. An unknown label
 * is a *resolved* `{ ok: false, code: "unknown-window" }`, because the plugin
 * converts the adapter's throw; a *rejected* invoke is what an unknown command
 * produces. Both shapes are pinned, so the difference cannot drift silently.
 *
 * `create` is proved from both ends. The page that asks for a window only sees
 * the plugin's answer, so the created windows load a document that runs the
 * same `app.js` in its own page context and reports back: its own URL and the
 * answer its own `invoke` got. That is what turns "a second NSWindow exists"
 * into an observation, and it is also how URL resolution is checked — the
 * relative request is resolved against the document the platform recorded for
 * an open window (`/spare/idle.html`, not this page's `/`), so the child must
 * land on `/spare/child/…`; an absolute one must load exactly as given. The
 * driver waits for those reports through a backend command (`seen`), so a
 * window that never loaded its page fails here instead of racing the close.
 *
 * Usage:
 *   bun scripts/e2e-window.ts    # or `bun run e2e:window`
 *
 * Two facts this script is built around:
 *
 *   - the runtime compiles the shim parts at launch, so a windowed
 *     run needs an Aqua session and a hard deadline with a `SIGTERM` to its
 *     process group; macOS ships no `timeout(1)`, so `e2e-harness.ts` owns that;
 *   - a built app runs with `/` as its working directory, which is what a
 *     double-clicked bundle gets, and the only claim about exiting that counts is
 *     the app ending itself: `window.close` on the last window must reach
 *     `window-all-closed`, print, and leave with code 0.
 *
 * The run itself lives beside this entry: `window/sandbox.ts` writes the
 * project, `window/fixture/` holds its sources and the driver page,
 * `window/proof.ts` builds, launches and parses, and `window/checks/` holds one
 * file per group of assertions in the order the page's answers arrive.
 */

import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { clearSurvivors, Verdict } from "./e2e-harness.ts";
import { proof } from "./window/proof.ts";

async function main(): Promise<number> {
	if (process.platform !== "darwin") {
		console.log(
			`e2e-window: SKIP  this proof builds a macOS .app and needs an Aqua session; ` +
				`running ${process.platform}/${process.arch}`,
		);
		return 1;
	}

	const verdict = new Verdict();
	const scratch = await mkdtemp(join(tmpdir(), "crust-e2e-window-"));
	let binary: string | undefined;
	try {
		binary = await proof(verdict, scratch);
	} finally {
		// A leaked bundle carries the scratch path in its argv, so it is clearable,
		// and the tree goes either way — a throw is not a reason to leave both.
		if (binary !== undefined) await clearSurvivors(binary).catch(() => undefined);
		await rm(scratch, { recursive: true, force: true }).catch(() => undefined);
	}

	const gone = await stat(scratch)
		.then(() => false)
		.catch(() => true);
	verdict.check("scratch gone", gone, gone ? `removed ${scratch}` : `${scratch} still exists`);

	return verdict.report("e2e-window");
}

try {
	process.exit(await main());
} catch (error) {
	// A throw is still a verdict: the scratch tree is removed in `main`, and the
	// reason is printed rather than buried in a stack trace.
	console.log(`e2e-window: FAIL  ${error instanceof Error ? error.message : String(error)}`);
	process.exit(1);
}
