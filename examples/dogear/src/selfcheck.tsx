/**
 * Dogear's own proof, run by the page when `DOGEAR_SELFCHECK=1`.
 *
 * Every call goes through `window.crust`, exactly as the UI calls it — no curl,
 * no second client, no click. One line per answer, mirrored to the terminal by
 * the `log` command, so a scripted run's stdout is evidence of what the page
 * saw. It touches one scratch file and no user note.
 *
 * The sequence is two groups: the file steps in `selfcheck/steps.tsx`, then the
 * two panels in `selfcheck/panels.tsx`. They are one run — the panel steps cancel
 * the sheet the file steps left up — so the order here is the order the e2e
 * asserts, and the step names are the strings it compares.
 */
import { makeChecks, type Reporter } from "./selfcheck/checks";
import { runPanelSteps } from "./selfcheck/panels";
import { runFileSteps } from "./selfcheck/steps";

export type { Reporter } from "./selfcheck/checks";

export async function runSelfCheck(report: Reporter, dir: string): Promise<void> {
	const checks = makeChecks(report);

	const note = await runFileSteps(checks, dir);
	if (note === undefined) return;

	await runPanelSteps(checks, note);

	report("done");
}
