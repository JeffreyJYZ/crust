/**
 * `create`: a real second `NSWindow`, and a document that runs in its own page
 * context. The page that asked only sees the plugin's answer, so the created
 * windows report for themselves.
 */
import type { Verdict } from "../../e2e-harness.ts";
import {
	childReport,
	goneAnswer,
	labelsOf,
	type PageAnswer,
	originOf,
	resolved,
	sameLabels,
	show,
} from "../answers.ts";

export function checkCreates(verdict: Verdict, byTag: Map<string, PageAnswer>): void {
	// ---- 10b. create: a real second NSWindow, and a document that runs ------
	// Created windows run this same script in their own context and report their
	// URL and their own invoke answer. A webview that never loaded the bridge
	// document has no page to report with, so the plugin's `ok` alone is not
	// evidence that an NSWindow exists.
	const createRel = resolved(byTag.get("createrel"));
	const createRelOk =
		createRel?.ok === true && createRel?.created === true && createRel?.label === "relative";
	verdict.check(
		"create relative",
		createRelOk,
		createRelOk ? `answered ${show(createRel)}` : `page saw ${show(byTag.get("createrel"))}`,
	);

	const relativeChild = childReport(byTag.get("child.relative"));
	const relativeOrigin = relativeChild === undefined ? undefined : originOf(relativeChild.href);
	const relativeOpen = resolved(relativeChild?.open);
	// The resolved URL, not the request: the base is the document `main` recorded
	// (`/spare/idle.html`), so `/spare/` is in the answer and `/` would mean the
	// request had been resolved against this page instead.
	const relativePath = relativeChild?.href === `${relativeOrigin}/spare/child/relative`;
	const relativeAsk =
		relativeOpen?.ok === true &&
		relativeOpen?.label === "relative" &&
		relativeOpen?.open === true;
	const relativeOk = relativeOrigin !== undefined && relativePath && relativeAsk;
	verdict.check(
		"child relative",
		relativeOk,
		relativeOk
			? `a second window loaded ${JSON.stringify(relativeChild?.href)} and its own invoke ` +
					`answered ${show(relativeOpen)}`
			: `href ${show(relativeChild?.href)} (resolved path ${relativePath}) from ` +
					`${show(byTag.get("child.relative"))}, invoke ${show(relativeOpen)}`,
	);

	const createAbs = resolved(byTag.get("createabs"));
	const createAbsOk =
		createAbs?.ok === true && createAbs?.created === true && createAbs?.label === "absolute";
	verdict.check(
		"create absolute",
		createAbsOk,
		createAbsOk ? `answered ${show(createAbs)}` : `page saw ${show(byTag.get("createabs"))}`,
	);

	// An absolute URL loads as given: the exact document the page named, at the
	// same origin as the resolved one. (A page cannot distinguish "passed through"
	// from "resolved to the same absolute string", so what is asserted here is the
	// load itself; `window.test.ts` pins the pass-through ordering against a
	// platform double, where both candidates are visible.)
	const absoluteChild = childReport(byTag.get("child.absolute"));
	const absoluteOpen = resolved(absoluteChild?.open);
	const absoluteOk =
		relativeOrigin !== undefined &&
		absoluteChild?.href === `${relativeOrigin}/spare/child/absolute` &&
		absoluteOpen?.ok === true &&
		absoluteOpen?.label === "absolute" &&
		absoluteOpen?.open === true;
	verdict.check(
		"child absolute",
		absoluteOk,
		absoluteOk
			? `loaded ${JSON.stringify(absoluteChild?.href)} and its own invoke answered ` +
					`${show(absoluteOpen)}`
			: `page saw ${show(byTag.get("child.absolute"))}`,
	);

	const sawRelative = byTag.get("sawrelative");
	const sawAbsolute = byTag.get("sawabsolute");
	const waitedOk =
		sawRelative?.how === "resolved" &&
		sawRelative?.value === true &&
		sawAbsolute?.how === "resolved" &&
		sawAbsolute?.value === true;
	verdict.check(
		"child waited",
		waitedOk,
		waitedOk
			? "both created windows' pages reported before the driver went on"
			: `waits answered ${show(sawRelative)} / ${show(sawAbsolute)}`,
	);

	// Both are tracked where every other command looks, which is what makes a
	// created window usable rather than only open.
	const lists2Ok = sameLabels(byTag.get("lists2"), ["main", "other", "relative", "absolute"]);
	verdict.check(
		"list children",
		lists2Ok,
		lists2Ok
			? `labels ${show(labelsOf(byTag.get("lists2")))}`
			: `list answered ${show(byTag.get("lists2"))}`,
	);

	const childOpen = resolved(byTag.get("childopen"));
	verdict.check(
		"child open",
		childOpen?.open === true,
		childOpen?.open === true
			? "the created window reports open: true"
			: `answered ${show(byTag.get("childopen"))}`,
	);

	const childTitle = resolved(byTag.get("childtitle"));
	const childTitleOk = childTitle?.ok === true && childTitle?.title === "Relative titled";
	verdict.check(
		"child title",
		childTitleOk,
		childTitleOk
			? `applied and read back ${JSON.stringify(childTitle?.title)}`
			: `answered ${show(byTag.get("childtitle"))}`,
	);

	const childClose = resolved(byTag.get("childclose"));
	const childCloseOk = childClose?.ok === true && childClose?.closed === true;
	verdict.check(
		"child close",
		childCloseOk,
		childCloseOk ? `answered ${show(childClose)}` : `answered ${show(byTag.get("childclose"))}`,
	);

	const childGone = goneAnswer(byTag.get("childgone"));
	verdict.check(
		"child gone",
		childGone,
		childGone
			? `answered ${show(resolved(byTag.get("childgone")))}`
			: `answered ${show(byTag.get("childgone"))}`,
	);

	const absClose = resolved(byTag.get("absclose"));
	const absCloseOk = absClose?.ok === true && absClose?.closed === true;
	verdict.check(
		"absolute close",
		absCloseOk,
		absCloseOk ? `answered ${show(absClose)}` : `answered ${show(byTag.get("absclose"))}`,
	);

	const absGone = goneAnswer(byTag.get("absgone"));
	verdict.check(
		"absolute gone",
		absGone,
		absGone
			? `answered ${show(resolved(byTag.get("absgone")))}`
			: `answered ${show(byTag.get("absgone"))}`,
	);

	// Closed is closed: the two windows the app was configured with are all that
	// is left, so a created window does not linger in the platform's map.
	const tidiedOk = sameLabels(byTag.get("tidied"), ["main", "other"]);
	verdict.check(
		"tidy",
		tidiedOk,
		tidiedOk
			? `labels ${show(labelsOf(byTag.get("tidied")))} after both children closed`
			: `list answered ${show(byTag.get("tidied"))}`,
	);
}
