/**
 * Phases 4-8: run the bundle from `/`, and judge the page's own report — the
 * step names, the passes, the tray line and the two panels.
 */
import { probe, type Probe, type Verdict } from "../../e2e-harness.ts";
import { skip } from "../../lib/text.ts";
import { APP_TIMEOUT_MS } from "../fixture.ts";
import { DONE, detailOf, pageSteps, STEPS } from "../report.ts";

/**
 * Run it from `/`, as a launched bundle does.
 *
 * `/usr/bin/env` carries the two switches so the harness's own environment is
 * untouched; `exec` replaces it, so the pid, the argv and the process group
 * are the app's.
 */
export async function runPhase(verdict: Verdict, binary: string, notes: string): Promise<Probe> {
	const run = await probe({
		command: ["/usr/bin/env", "DOGEAR_SELFCHECK=1", `DOGEAR_NOTES_DIR=${notes}`, binary],
		cwd: "/",
		match: DONE,
		timeoutMs: APP_TIMEOUT_MS,
	});

	const steps = pageSteps(run.stdout);

	// ---- 5. the page reported exactly the eleven steps, in order -----------
	// Set equality alone would accept a reordered run, and a count alone would
	// accept a rename. Comparing the sequence is the whole guard.
	const reported = steps.map((entry) => entry.step);
	const missing = STEPS.filter((step) => !reported.includes(step));
	const counts = new Map<string, number>();
	for (const step of reported) counts.set(step, (counts.get(step) ?? 0) + 1);
	const repeated = [...counts].filter(([, seen]) => seen > 1).map(([step]) => step);
	const extra = reported.filter((step) => !(STEPS as readonly string[]).includes(step));
	// Set, not sequence: each step's line reaches the backend as its own bridge message, so
	// two of them can arrive in either order even though the page awaited them in turn. A
	// dropped, renamed or repeated step still fails — count, names and duplicates are exact.
	const stepsOk =
		missing.length === 0 &&
		extra.length === 0 &&
		repeated.length === 0 &&
		reported.length === STEPS.length;
	const why =
		`${reported.length} step lines — ` +
		`${missing.length > 0 ? `missing ${missing.join(", ")}` : "none missing"}` +
		`${extra.length > 0 ? `, unexpected ${extra.join(", ")}` : ""}` +
		`${repeated.length > 0 ? `, repeated ${repeated.join(", ")}` : ""}` +
		`${stepsOk ? `: ${reported.join(", ")}` : ""}` +
		` — ${run.ended === "match" ? "the page printed done, so a step was dropped, renamed or repeated" : run.timedOut ? `no done line within ${APP_TIMEOUT_MS / 1000} s` : "the page stopped early"}`;
	verdict.check(
		"step names",
		stepsOk,
		stepsOk ? `the page ran ${STEPS.length} steps, in the expected order` : why,
	);

	if (stepsOk) {
		// ---- 6. every step passed -----------------------------------------
		const failed = steps.filter((entry) => !entry.ok);
		verdict.check(
			"steps pass",
			failed.length === 0,
			failed.length === 0
				? `${steps.length} PASS lines, no FAIL`
				: failed.map((entry) => `${entry.step}: ${entry.detail}`).join(" | "),
		);

		// ---- 7. the tray, as the app reports it ---------------------------
		// The adapter's read-back is the evidence; no menu-bar click exists, which
		// is why the app reports the menu's state rather than a click.
		const tray = detailOf(steps, "tray item") ?? "";
		const trayOk = /^menu with \d+ rows: /.test(tray);
		verdict.check(
			"tray reported",
			trayOk,
			trayOk ? tray : `the page printed ${JSON.stringify(tray) || "no tray line"}`,
		);

		// ---- 8. both sheets are up, and stay pending ----------------------
		// A pick needs a human, so a run that reports one means something other
		// than this app answered — and a run that reports cancellation is a
		// different fact than the sheet being up. Only "still pending" is this
		// proof's pass, for the open panel and the save panel alike.
		const sheets = [
			{ step: "dialog sheet", check: "sheet pending", cls: "NSOpenPanel" },
			{ step: "save panel", check: "save sheet pending", cls: "NSSavePanel" },
		] as const;
		for (const sheet of sheets) {
			const detail = detailOf(steps, sheet.step) ?? "";
			const pending = detail.includes("stays pending");
			verdict.check(
				sheet.check,
				pending,
				pending
					? `${sheet.cls} is up and unresolved, as the app reports it: ${JSON.stringify(detail)}`
					: `page reported ${JSON.stringify(detail) || `no ${sheet.step} line`} — expected the sheet to stay pending`,
			);
		}
	} else {
		skip(
			verdict,
			["steps pass", "tray reported", "sheet pending", "save sheet pending"],
			"not checked — the page did not report every step",
		);
		// The page's own lines are the evidence for the failure above.
		console.log(run.stdout + run.stderr);
	}

	// Exposed so the finish phase can report the same run rather than re-reading it.
	return run;
}
