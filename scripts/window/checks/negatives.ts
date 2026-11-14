/**
 * The two failure shapes, kept distinct on purpose: an unknown command is a
 * rejected invoke, a bad label is a resolved typed failure, and the backend is
 * still alive after both.
 */
import type { Verdict } from "../../e2e-harness.ts";
import { type PageAnswer, resolved, show } from "../answers.ts";

export function checkNegatives(verdict: Verdict, byTag: Map<string, PageAnswer>): void {
	// ---- 10. negatives: unknown command and a non-string label -------------
	// Two different shapes on purpose. An unknown command is a *rejected* invoke
	// (the bridge's `unknown-command`, status 404); a bad label is a resolved
	// `invalid-label` failure the plugin builds before any selector is sent.
	const unknown = byTag.get("unknown");
	const unknownOk =
		unknown?.how === "rejected" &&
		unknown?.code === "unknown-command" &&
		unknown?.status === 404;
	verdict.check(
		"unknown cmd",
		unknownOk,
		unknownOk
			? `rejected ${show({ code: unknown?.code, status: unknown?.status, name: unknown?.name })}`
			: `page saw ${show(unknown)}`,
	);

	const badLabel = byTag.get("badlabel");
	const badOk = badLabel?.how === "resolved" && resolved(badLabel)?.code === "invalid-label";
	verdict.check(
		"bad label",
		badOk,
		badOk ? `resolved ${show(resolved(badLabel))} with a code` : `page saw ${show(badLabel)}`,
	);

	// The backend is still there after both: a further command answers normally.
	const alive = resolved(byTag.get("alive"));
	const aliveOk = alive?.ok === true && Array.isArray(alive?.labels) && alive.labels.length === 2;
	verdict.check(
		"alive after",
		aliveOk,
		aliveOk
			? "the backend answered a further list after both failures"
			: `answered ${show(byTag.get("alive"))}`,
	);
}
