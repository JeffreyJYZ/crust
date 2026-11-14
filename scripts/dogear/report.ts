/**
 * The page's own report: the eleven steps it runs, the shape of one PASS line,
 * and the assertion names a failed step leaves unknowable.
 */

/**
 * Every step the page reports, in the order `src/selfcheck.tsx` runs them. This
 * list is the guard: a step that stops running shrinks the page's output, and
 * the comparison below fails instead of accepting ten of eleven.
 */
export const STEPS = [
	"notes listed",
	"note stat",
	"note read",
	"window title",
	"tray item",
	"save",
	"save read back",
	"rename",
	"remove",
	"dialog sheet",
	"save panel",
] as const;

/** The page's last line, after the save-panel step. */
export const DONE = /^\s+page\s+done\s*$/m;

/** One `  page      PASS <step> — <detail>` line. Step names hold no em dash. */
export const STEP_LINE = /^\s+page\s+(PASS|FAIL)\s+([^—\s][^—]*?)\s+—\s*(.*)$/;

/**
 * Assertions a failed step makes unknowable. Named here rather than invented at
 * the call site so a renamed assertion cannot leave the report short by one.
 */
export const AFTER_BUILD = [
	"bundle",
	"binary",
	"step names",
	"steps pass",
	"tray reported",
	"sheet pending",
	"save sheet pending",
	"done",
	"exit 0",
	"no survivors",
	"notes seeded",
	"notes clean",
] as const;

/** Everything that needs the app to have run at all. */
export const AFTER_RUN = [
	"step names",
	"steps pass",
	"tray reported",
	"sheet pending",
	"save sheet pending",
	"done",
	"exit 0",
	"no survivors",
	"notes seeded",
	"notes clean",
] as const;

export interface ReporterStep {
	step: string;
	ok: boolean;
	detail: string;
}

/** Every PASS/FAIL line the page printed, in order. */
export function pageSteps(text: string): ReporterStep[] {
	const found: ReporterStep[] = [];
	for (const line of text.split("\n")) {
		const match = STEP_LINE.exec(line);
		const state = match?.[1];
		const step = match?.[2];
		if (state === undefined || step === undefined) continue;
		found.push({ step: step.trim(), ok: state === "PASS", detail: match?.[3]?.trim() ?? "" });
	}
	return found;
}

/** The detail of one named step, or undefined when the page never reported it. */
export function detailOf(steps: ReporterStep[], step: string): string | undefined {
	return steps.find((entry) => entry.step === step)?.detail;
}
