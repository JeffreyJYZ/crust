/**
 * E2E for macOS fullscreen: scratch project, `crust build`, ad-hoc sign, then the bundle's binary
 * launched directly from `/` — never `open`, which routes through LaunchServices and hides which
 * process ran. The page asks the real `crust:window` path for a transition and reports what it sees,
 * and the app's own backend reads the live `NSWindow`'s collection behaviour and style mask, so
 * "the window is fullscreen-primary" is a measurement rather than the plugin's `ok`. Files in
 * `fullscreen/`. Must exit 0 through `window-all-closed`, with focus handed back.
 */

import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { clearSurvivors, guardFocus, restoreFocus, Verdict } from "./e2e-harness.ts";
import { proof } from "./fullscreen/proof.ts";

async function main(): Promise<number> {
	if (process.platform !== "darwin") {
		console.log(
			`e2e-fullscreen: SKIP  this proof builds a macOS .app and needs an Aqua session; ` +
				`running ${process.platform}/${process.arch}`,
		);
		return 1;
	}

	const verdict = new Verdict();
	// Armed before the proof launches its window. Its decision is what the `finally` restores; a
	// Ctrl-C runs no `finally`, so the guard also restores on `exit` and the three signals.
	const frontmost = guardFocus();
	const scratch = await mkdtemp(join(tmpdir(), "crust-e2e-fullscreen-"));
	let binary: string | undefined;
	try {
		binary = await proof(verdict, scratch);
	} finally {
		// A leaked bundle carries the scratch path in its argv, so it is clearable, and the tree goes
		// either way — a throw is not a reason to leave both.
		if (binary !== undefined) await clearSurvivors(binary).catch(() => undefined);
		await rm(scratch, { recursive: true, force: true }).catch(() => undefined);
		// Last, so a red run does not leave the human looking at the window it opened.
		await restoreFocus(frontmost);
	}

	const gone = await stat(scratch)
		.then(() => false)
		.catch(() => true);
	verdict.check("scratch gone", gone, gone ? `removed ${scratch}` : `${scratch} still exists`);

	return verdict.report("e2e-fullscreen");
}

try {
	process.exit(await main());
} catch (error) {
	// A throw is still a verdict: the scratch tree is removed in `main`, and the reason is printed
	// rather than buried in a stack trace.
	console.log(`e2e-fullscreen: FAIL  ${error instanceof Error ? error.message : String(error)}`);
	process.exit(1);
}
