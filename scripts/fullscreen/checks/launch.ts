/**
 * The state a launched window is in, before any transition: the page is the window's own document,
 * the live `NSWindow` is fullscreen-primary and not auxiliary, it landed on the active Space, and it
 * is not already fullscreen.
 */
import type { Verdict } from "../../e2e-harness.ts";
import { type PageAnswer, resolved, show } from "../../window/answers.ts";
import { probeOf } from "../answers.ts";
import {
	FULLSCREEN_AUXILIARY,
	FULLSCREEN_PRIMARY,
	STYLE_MASK_FULLSCREEN,
} from "../expectations.ts";
import { LABEL } from "../fixture/config.ts";
import { bits, probeDetail, readOf } from "./describe.ts";

export function checkLaunch(verdict: Verdict, byTag: Map<string, PageAnswer>): void {
	// ---- 1. the page is the window's own document ---------------------------
	const label = resolved(byTag.get("label"));
	const labelled = label?.ok === true && label.label === LABEL;
	verdict.check(
		"page label",
		labelled,
		labelled
			? `the page's own request carried ${JSON.stringify(label?.label)}`
			: `page saw ${show(byTag.get("label"))}`,
	);

	// ---- 2. the window is fullscreen-primary, and not an auxiliary ----------
	// The green-button bit, read from the live NSWindow before any transition: this is the state a
	// launched app is in when the human looks at the titlebar.
	const before = probeOf(byTag.get("probe0"));
	const primary = before !== undefined && (before.collectionBehavior & FULLSCREEN_PRIMARY) !== 0;
	verdict.check(
		"fullscreen primary",
		primary,
		before === undefined
			? readOf(byTag.get("probe0"), "launch")
			: `${probeDetail(before, "launch")} — ` +
					`${before.collectionBehavior & FULLSCREEN_PRIMARY ? "carries" : "lacks"} 128`,
	);

	const auxiliary =
		before !== undefined && (before.collectionBehavior & FULLSCREEN_AUXILIARY) === 0;
	verdict.check(
		"not auxiliary",
		auxiliary,
		before === undefined
			? readOf(byTag.get("probe0"), "launch")
			: `${probeDetail(before, "launch")} — ` +
					`${before.collectionBehavior & FULLSCREEN_AUXILIARY ? "still carries" : "clear of"} 256`,
	);

	const alone = before !== undefined && before.found;
	verdict.check(
		"window found",
		alone,
		before === undefined
			? readOf(byTag.get("probe0"), "launch")
			: `the first window AppKit listed is ${before.windowNumber}` +
					`${before.found ? ", the one this page is in" : ", not the one this page is in"}`,
	);

	// ---- 3. it landed on the Space the user is looking at ------------------
	// Read after the window's own move to the active Space settled, because AppKit lists a window
	// there only once the app's activation has landed; the wait is reported beside the answer.
	const waited = resolved(byTag.get("space0"))?.waitedMs;
	const onSpace = before?.onActiveSpace === 1;
	verdict.check(
		"on active space",
		onSpace,
		before === undefined
			? readOf(byTag.get("probe0"), "launch")
			: `-isOnActiveSpace answered ${before.onActiveSpace} with the app active ${before.active}` +
					(typeof waited === "number" ? `, after waiting ${waited} ms` : ""),
	);

	const windowed = before !== undefined && (before.styleMask & STYLE_MASK_FULLSCREEN) === 0;
	verdict.check(
		"starts windowed",
		windowed,
		before === undefined
			? readOf(byTag.get("probe0"), "launch")
			: `styleMask ${bits(before.styleMask)} ` +
					`${before.styleMask & STYLE_MASK_FULLSCREEN ? "already has" : "has not got"} 1<<14`,
	);
}
