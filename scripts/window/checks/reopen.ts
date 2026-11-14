/**
 * A released label comes back, a live one is refused: the two halves of `create`
 * that depend on what the platform still tracks.
 */
import type { Verdict } from "../../e2e-harness.ts";
import {
	childReport,
	labelsOf,
	type PageAnswer,
	originOf,
	resolved,
	sameLabels,
	show,
} from "../answers.ts";

export function checkReopen(verdict: Verdict, byTag: Map<string, PageAnswer>): void {
	// ---- 12. create: a released label comes back, a live one is refused -----
	// `list` stops reporting a closed label immediately, so the page only has to
	// confirm it: the label is reusable, and `create` is what drops the platform's
	// stale entry for it (a tracked-but-closed label makes `createWindow` throw
	// "already exists"). A label still open is refused instead — nothing released.
	const released = byTag.get("released");
	const releasedOk = released?.how === "resolved" && released?.value === true;
	verdict.check(
		"released",
		releasedOk,
		releasedOk
			? "the closed label left the platform's list before create"
			: `page saw ${show(released)}`,
	);

	const recreated = resolved(byTag.get("recreate"));
	const recreateOk =
		recreated?.ok === true && recreated?.created === true && recreated?.label === "main";
	verdict.check(
		"recreate",
		recreateOk,
		recreateOk
			? `answered ${show(recreated)} — the released label was reusable`
			: `page saw ${show(byTag.get("recreate"))}`,
	);

	// The re-created label loads its document again: the window's own page ran,
	// and its own invoke found the window open under the same label. Without a
	// fresh page there would be no `child.main` report at all.
	const reopenChild = childReport(byTag.get("child.main"));
	const reopenOrigin = reopenChild === undefined ? undefined : originOf(reopenChild.href);
	const reopenPage = resolved(reopenChild?.open);
	const reopenLoadsOk =
		reopenOrigin !== undefined &&
		reopenChild?.href === `${reopenOrigin}/spare/child/main` &&
		reopenPage?.ok === true &&
		reopenPage?.label === "main" &&
		reopenPage?.open === true;
	verdict.check(
		"reopen loads",
		reopenLoadsOk,
		reopenLoadsOk
			? `the reused label loaded ${JSON.stringify(reopenChild?.href)} and its page invokes ` +
					`back ${show(reopenPage)}`
			: `page saw ${show(byTag.get("child.main"))}`,
	);

	const relist = resolved(byTag.get("relist"));
	const relabels = relist?.labels;
	const relistOk =
		Array.isArray(relabels) &&
		relabels.length === 2 &&
		relabels.includes("main") &&
		relabels.includes("other");
	verdict.check(
		"relist",
		relistOk,
		relistOk ? `labels ${show(relabels)}` : `list answered ${show(byTag.get("relist"))}`,
	);

	const reopenOpen = resolved(byTag.get("reopenopen"));
	verdict.check(
		"reopen open",
		reopenOpen?.open === true,
		reopenOpen?.open === true
			? "the re-created window reports open: true"
			: `answered ${show(byTag.get("reopenopen"))}`,
	);

	const reopenTitle = resolved(byTag.get("reopenset"));
	const reopenTitleOk = reopenTitle?.ok === true && reopenTitle?.title === "Reopened and titled";
	verdict.check(
		"reopen title",
		reopenTitleOk,
		reopenTitleOk
			? `applied and read back ${JSON.stringify(reopenTitle?.title)}`
			: `answered ${show(byTag.get("reopenset"))}`,
	);

	// A live label is refused before anything is released, so the window a page
	// already holds cannot be replaced behind its back.
	const duplicate = resolved(byTag.get("dup"));
	const duplicateOk = duplicate?.ok === false && duplicate?.code === "duplicate-label";
	verdict.check(
		"duplicate",
		duplicateOk,
		duplicateOk
			? `create on a live label answered ${show(duplicate)}`
			: `page saw ${show(byTag.get("dup"))}`,
	);

	// Nothing was created either: a refused create must not leave an entry behind
	// under the label it was refused for.
	const dupListOk = sameLabels(byTag.get("duplist"), ["main", "other"]);
	verdict.check(
		"duplicate list",
		dupListOk,
		dupListOk
			? `labels ${show(labelsOf(byTag.get("duplist")))} — unchanged`
			: `list answered ${show(byTag.get("duplist"))}`,
	);

	const dupAfter = resolved(byTag.get("dupafter"));
	verdict.check(
		"duplicate kept",
		dupAfter?.open === true,
		dupAfter?.open === true
			? "the refused label's window is still open — nothing was released"
			: `answered ${show(byTag.get("dupafter"))}`,
	);
}
