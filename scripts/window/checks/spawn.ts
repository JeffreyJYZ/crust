/**
 * A label that never existed, and the arguments that are refused before a
 * window is built for them.
 */
import type { Verdict } from "../../e2e-harness.ts";
import { goneAnswer, labelsOf, type PageAnswer, resolved, sameLabels, show } from "../answers.ts";

export function checkSpawns(verdict: Verdict, byTag: Map<string, PageAnswer>): void {
	// A label that never existed: created, found by `list`/`isOpen`, titled, closed.
	const created = resolved(byTag.get("create"));
	const createOk =
		created?.ok === true && created?.created === true && created?.label === "spawn";
	verdict.check(
		"create",
		createOk,
		createOk ? `answered ${show(created)}` : `page saw ${show(byTag.get("create"))}`,
	);

	const lists = resolved(byTag.get("lists"));
	const spawnLabels = lists?.labels;
	const listsOk =
		Array.isArray(spawnLabels) &&
		spawnLabels.length === 3 &&
		spawnLabels.includes("main") &&
		spawnLabels.includes("other") &&
		spawnLabels.includes("spawn");
	verdict.check(
		"list after create",
		listsOk,
		listsOk ? `labels ${show(spawnLabels)}` : `list answered ${show(byTag.get("lists"))}`,
	);

	const spawnOpen = resolved(byTag.get("spawnopen"));
	verdict.check(
		"spawn open",
		spawnOpen?.open === true,
		spawnOpen?.open === true
			? "the created window reports open: true"
			: `answered ${show(byTag.get("spawnopen"))}`,
	);

	const spawnTitle = resolved(byTag.get("spawnset"));
	const spawnTitleOk = spawnTitle?.ok === true && spawnTitle?.title === "Spawn titled";
	verdict.check(
		"spawn title",
		spawnTitleOk,
		spawnTitleOk
			? `applied and read back ${JSON.stringify(spawnTitle?.title)}`
			: `answered ${show(byTag.get("spawnset"))}`,
	);

	const spawnClose = resolved(byTag.get("spawnclose"));
	const spawnCloseOk = spawnClose?.ok === true && spawnClose?.closed === true;
	verdict.check(
		"spawn close",
		spawnCloseOk,
		spawnCloseOk ? `answered ${show(spawnClose)}` : `answered ${show(byTag.get("spawnclose"))}`,
	);

	const spawnGone = goneAnswer(byTag.get("spawngone"));
	verdict.check(
		"spawn gone",
		spawnGone,
		spawnGone
			? `answered ${show(resolved(byTag.get("spawngone")))}`
			: `answered ${show(byTag.get("spawngone"))}`,
	);

	// Refused arguments, not clamped or coerced: no window is built for either, so
	// neither label is in the platform's map afterwards.
	const badSize = resolved(byTag.get("badsize"));
	const badSizeOk = badSize?.ok === false && badSize?.code === "invalid-size";
	verdict.check(
		"bad size",
		badSizeOk,
		badSizeOk ? `answered ${show(badSize)}` : `page saw ${show(byTag.get("badsize"))}`,
	);

	// A size a cast would have rounded is refused too, not turned into a window.
	const badFraction = resolved(byTag.get("badfraction"));
	const badFractionOk = badFraction?.ok === false && badFraction?.code === "invalid-size";
	verdict.check(
		"bad fraction",
		badFractionOk,
		badFractionOk
			? `answered ${show(badFraction)}`
			: `page saw ${show(byTag.get("badfraction"))}`,
	);

	const badUrl = resolved(byTag.get("badurl"));
	const badUrlOk = badUrl?.ok === false && badUrl?.code === "invalid-url";
	verdict.check(
		"bad url",
		badUrlOk,
		badUrlOk ? `answered ${show(badUrl)}` : `page saw ${show(byTag.get("badurl"))}`,
	);

	// Every refused label was refused before a window existed: none of the three
	// is in the platform's map, and the two configured labels are untouched.
	const refusedList = labelsOf(byTag.get("reflist"));
	const refusedOk =
		sameLabels(byTag.get("reflist"), ["main", "other"]) &&
		refusedList !== undefined &&
		!refusedList.includes("tiny") &&
		!refusedList.includes("fraction") &&
		!refusedList.includes("nowhere");
	verdict.check(
		"refused nothing",
		refusedOk,
		refusedOk
			? `labels ${show(refusedList)} — no window was built for a refused argument`
			: `list answered ${show(byTag.get("reflist"))}`,
	);

	const closeAgain = resolved(byTag.get("closeagain"));
	const closeAgainOk = closeAgain?.ok === true && closeAgain?.closed === true;
	verdict.check(
		"close again",
		closeAgainOk,
		closeAgainOk ? `answered ${show(closeAgain)}` : `answered ${show(byTag.get("closeagain"))}`,
	);

	const mainGone = goneAnswer(byTag.get("maingone"));
	verdict.check(
		"close again gone",
		mainGone,
		mainGone
			? `answered ${show(resolved(byTag.get("maingone")))}`
			: `answered ${show(byTag.get("maingone"))}`,
	);
}
