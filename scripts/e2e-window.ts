/**
 * E2E for `crust:window` through the real path: scratch project, `crust build`, ad-hoc sign, then the bundle's binary launched directly — never `open`, which routes through LaunchServices and hides which process ran.
 * Created windows run `app.js` themselves and report their own URL and `invoke` answer, so "a second NSWindow exists" is an observation, not the plugin's `ok`; an unknown label resolves `{ ok: false, code: "unknown-window" }` while an unknown command rejects. Runs from `/` and must exit 0 via `window-all-closed`. Files in `window/`.
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
