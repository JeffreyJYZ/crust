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
	urlOf,
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
	const relativeUrl = relativeChild === undefined ? undefined : urlOf(relativeChild.href);
	const relativeOpen = resolved(relativeChild?.open);
	const relativeLabel = resolved(relativeChild?.label);
	// The resolved URL, not the request: the base is the document `main` recorded
	// (`/spare/idle.html`), so `/spare/` is in the answer and `/` would mean the
	// request had been resolved against this page instead. The query is crust's own
	// — the window's identity rides in its URL — so the path must be exact and the
	// label the one the window was created under, answered by its own page.
	const relativePath = relativeUrl?.pathname === "/spare/child/relative";
	const relativeIdentity = relativeUrl?.searchParams.get("window") === "relative";
	const relativeAsk =
		relativeOpen?.ok === true &&
		relativeOpen?.label === "relative" &&
		relativeOpen?.open === true;
	const relativeOwn = relativeLabel?.ok === true && relativeLabel?.label === "relative";
	const relativeOk =
		relativeOrigin !== undefined &&
		relativePath &&
		relativeIdentity &&
		relativeAsk &&
		relativeOwn;
	verdict.check(
		"child relative",
		relativeOk,
		relativeOk
			? `a second window loaded ${JSON.stringify(relativeChild?.href)}, its own invoke ` +
					`answered ${show(relativeOpen)}, and window.label answered ${show(relativeLabel)}`
			: `href ${show(relativeChild?.href)} (path ${relativePath}, identity ` +
					`${relativeIdentity}, window.label ${show(relativeChild?.label)}) from ` +
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

	// An absolute bridge-owned URL loads the path the page named, but crust forces the command's
	// native label into the query before appending the seed token. That is what binds the minted
	// document token to this window instead of `main`; leaving `window=` absent made the document
	// route fall back to `main` and handed a `window:create` caller main's grants. Both the URL's
	// `window` parameter and the page's own `window.label` answer must name this window.
	const absoluteChild = childReport(byTag.get("child.absolute"));
	const absoluteUrl = absoluteChild === undefined ? undefined : urlOf(absoluteChild.href);
	const absoluteOpen = resolved(absoluteChild?.open);
	const absoluteLabel = resolved(absoluteChild?.label);
	const absoluteIdentity = absoluteUrl?.searchParams.get("window") === "absolute";
	const absoluteOwn = absoluteLabel?.ok === true && absoluteLabel?.label === "absolute";
	const absoluteOk =
		relativeOrigin !== undefined &&
		absoluteUrl?.pathname === "/spare/child/absolute" &&
		absoluteIdentity &&
		absoluteOpen?.ok === true &&
		absoluteOpen?.label === "absolute" &&
		absoluteOpen?.open === true &&
		absoluteOwn;
	verdict.check(
		"child absolute",
		absoluteOk,
		absoluteOk
			? `loaded ${JSON.stringify(absoluteChild?.href)} with ?window=absolute, its own ` +
					`invoke answered ${show(absoluteOpen)}, and window.label answered ` +
					`${show(absoluteLabel)}`
			: `page saw ${show(byTag.get("child.absolute"))} (path ` +
					`${absoluteUrl?.pathname}, identity ${absoluteIdentity}, ` +
					`window.label ${show(absoluteLabel)})`,
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
