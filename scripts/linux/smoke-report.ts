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

/**
 * Two slices of the real main context, which is the pump a running app depends on. `ticks` advances
 * only when `shim_pump` reports a native iteration, so a JS timer keep-alive alone cannot pass it.
 */
export async function pumpStep(platform: {
	pump(intervalMs: number): void;
	ticks: number;
}): Promise<{ ok: boolean; detail: string }> {
	platform.pump(16);
	await Bun.sleep(120);
	const ticks = platform.ticks;
	return {
		ok: ticks >= 2,
		detail: `${ticks} g_main_context_iteration slices in 120 ms at a 16 ms interval`,
	};
}

/**
 * The final liveness read. `shim_window_alive` is the call that would fault on a stale widget, so it is
 * asserted after the pump and the page's own calls rather than once at creation.
 */
export function livenessStep(platform: { window(label: string): unknown }): {
	ok: boolean;
	detail: string;
} {
	return {
		ok: platform.window("smoke") !== undefined,
		detail: "shim_window_alive still answers 1 after the pump and the page's own calls",
	};
}

/** What this smoke does not prove, printed once at the end so an absence is never silent. */
export const NOT_PROVEN =
	"not proven here: the app's built frontend, any plugin's effect on the machine, and a picture of " +
	"the placed surface — window.capture has no WebKitGTK path yet, so browser.capture refuses by " +
	"name instead of screenshotting the screen.";

/** One verdict per step, quoting the smoke's own line so the answer travels with it. */
export function checkSmokeSteps(verdict: Verdict, transcript: string): void {
	const lines = transcript.split("\n");
	for (const step of SMOKE_STEPS) {
		const line = lines.find((entry) => entry.match(`^(?:PASS|FAIL)\\s+${step}\\s`));
		verdict.check(step, line?.startsWith("PASS") === true, line ?? `no line for ${step}`);
	}
}
