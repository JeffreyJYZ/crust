/**
 * The driver's reading of the smoke's transcript: the steps it prints, in order, and one verdict per
 * step. The list is the smoke's own, so a step it gains is a step the gate asserts — the two cannot
 * drift, and neither file grows a second copy of the names.
 */
import type { Verdict } from "../e2e-harness.ts";

/** The steps `scripts/linux-smoke.ts` prints, in the order it prints them. */
export const SMOKE_STEPS = [
	"document",
	"js",
	"invoke",
	"events",
	"ready",
	"surface",
	"failure",
	"state",
] as const;

/** One verdict per step, quoting the smoke's own line so the answer travels with it. */
export function checkSmokeSteps(verdict: Verdict, transcript: string): void {
	const lines = transcript.split("\n");
	for (const step of SMOKE_STEPS) {
		const line = lines.find((entry) => entry.match(`^(?:PASS|FAIL)\\s+${step}\\s`));
		verdict.check(step, line?.startsWith("PASS") === true, line ?? `no line for ${step}`);
	}
}
