/**
 * The open windows: what `list`/`isOpen` say, what a title does, and that
 * `focus` reaches a different `NSWindow` without moving the set of windows.
 */
import type { Verdict } from "../../e2e-harness.ts";
import { type PageAnswer, resolved, show } from "../answers.ts";
import { APPLIED_TITLE } from "../fixture/config.ts";

export function checkWindows(verdict: Verdict, byTag: Map<string, PageAnswer>): void {
	// ---- 6. list and isOpen tell the truth about the open windows ----------
	const list0 = resolved(byTag.get("list0"));
	const labels0 = list0?.labels;
	const bothListed =
		Array.isArray(labels0) &&
		labels0.length === 2 &&
		labels0.includes("main") &&
		labels0.includes("other");
	verdict.check(
		"list open",
		bothListed,
		bothListed ? `labels ${show(labels0)}` : `list answered ${show(byTag.get("list0"))}`,
	);

	const main0 = resolved(byTag.get("main0"));
	verdict.check(
		"isOpen main",
		main0?.open === true,
		main0?.open === true ? "main reports open: true" : `answered ${show(byTag.get("main0"))}`,
	);

	const other0 = resolved(byTag.get("other0"));
	verdict.check(
		"isOpen other",
		other0?.open === true,
		other0?.open === true
			? "other reports open: true"
			: `answered ${show(byTag.get("other0"))}`,
	);

	// ---- 7. a label that does not exist: not listed, and a typed failure ----
	// The shape is the measured one: the plugin converts the adapter's throw, so
	// the page's promise *resolves* with a failure value. A rejected invoke is a
	// different path, asserted in step 10, and conflating the two would hide which
	// one a page has to handle.
	const ghostListed = Array.isArray(labels0) && labels0.includes("ghost");
	verdict.check(
		"ghost absent",
		!ghostListed,
		ghostListed ? `list answered ${show(labels0)}` : "no window labelled ghost is listed",
	);

	const ghost = byTag.get("ghost");
	const ghostOk = ghost?.how === "resolved" && resolved(ghost)?.code === "unknown-window";
	verdict.check(
		"isOpen ghost",
		ghostOk,
		ghostOk
			? `resolved { ok: false, code: "unknown-window" } for the missing label`
			: `page saw ${show(ghost)}`,
	);

	// ---- 8. setTitle applies, and an impossible title is an error ----------
	// The adapter reads the title back from AppKit and only then answers ok, so a
	// resolved `{ ok: true, title }` is the read-back proof; a title the window
	// cannot hold must not resolve ok.
	const title = resolved(byTag.get("title"));
	const titleOk = title?.ok === true && title?.title === APPLIED_TITLE;
	verdict.check(
		"setTitle",
		titleOk,
		titleOk
			? `applied and read back ${JSON.stringify(title?.title)}`
			: `answered ${show(byTag.get("title"))}`,
	);

	const titleBad = byTag.get("titlebad");
	const titleFailure = resolved(titleBad);
	const titleBadOk = titleFailure?.ok === false && titleFailure?.code === "handler-error";
	verdict.check(
		"setTitle bad",
		titleBadOk,
		titleBadOk
			? `a NUL title answered ${show(titleFailure)} — an error, not a silent success`
			: `page saw ${show(titleBad)}`,
	);

	// ---- 9. focus: a no-op that answers ok, twice the same -----------------
	const focus1 = resolved(byTag.get("focus1"));
	const focus2 = resolved(byTag.get("focus2"));
	const focusOk = focus1?.focused === true && focus1?.label === "main";
	verdict.check(
		"focus",
		focusOk,
		focusOk ? `answered ${show(focus1)}` : `answered ${show(byTag.get("focus1"))}`,
	);

	// The observable, not the intent: a page cannot see which window is key, so
	// what is assertable is that the second call answers exactly what the first
	// did — no state machine, no drift, no error on a repeat.
	const sameTwice = focusOk && show(focus1) === show(focus2);
	verdict.check(
		"focus twice",
		sameTwice,
		sameTwice
			? "second focus answered identically"
			: `first ${show(focus1)} / second ${show(byTag.get("focus2"))}`,
	);

	// A different label is a different NSWindow: the call must reach it and answer
	// ok. That both windows survive is asserted after the second list.
	const focusOther = resolved(byTag.get("focusother"));
	const focusOtherOk = focusOther?.focused === true && focusOther?.label === "other";
	verdict.check(
		"focus other",
		focusOtherOk,
		focusOtherOk
			? `answered ${show(focusOther)} for the second window`
			: `answered ${show(byTag.get("focusother"))}`,
	);

	const focusGhost = byTag.get("focusghost");
	const ghostFocusOk =
		focusGhost?.how === "resolved" && resolved(focusGhost)?.code === "unknown-window";
	verdict.check(
		"focus ghost",
		ghostFocusOk,
		ghostFocusOk
			? "a label that does not exist answered the typed failure"
			: `page saw ${show(focusGhost)}`,
	);

	const list1 = resolved(byTag.get("list1"));
	const labels1 = list1?.labels;
	const stillTwo =
		Array.isArray(labels1) &&
		labels1.length === 2 &&
		labels1.includes("main") &&
		labels1.includes("other");
	verdict.check(
		"after focus",
		stillTwo,
		stillTwo
			? `labels unchanged: ${show(labels1)}`
			: `list answered ${show(byTag.get("list1"))}`,
	);
}
