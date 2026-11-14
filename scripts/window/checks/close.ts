/**
 * Closing the spare: `close` reports the change, `isOpen` reports the typed
 * failure, and the other window keeps the app up.
 */
import type { Verdict } from "../../e2e-harness.ts";
import { goneAnswer, type PageAnswer, resolved, show } from "../answers.ts";

export function checkCloseOfMain(verdict: Verdict, byTag: Map<string, PageAnswer>): void {
	// ---- 11. close: state changes, and the last close ends the app ---------
	const closeMain = resolved(byTag.get("closemain"));
	const closed = closeMain?.ok === true && closeMain?.closed === true;
	verdict.check(
		"close main",
		closed,
		closed ? `answered ${show(closeMain)}` : `answered ${show(byTag.get("closemain"))}`,
	);

	// The platform reports only windows AppKit still holds, so a closed label is
	// already out of `list` — and the plugin answers from `list` first. The page's
	// observable is therefore the typed failure, not `open: false`.
	const mainAfter = byTag.get("mainafter");
	const notOpen = goneAnswer(mainAfter);
	verdict.check(
		"isOpen closed",
		notOpen,
		notOpen ? `answered ${show(resolved(mainAfter))}` : `answered ${show(mainAfter)}`,
	);

	// Closing one window is not "all closed": the other one keeps the app up, which
	// is what makes the next close the thing that ends it.
	const otherStill = resolved(byTag.get("otherstill"));
	const otherUp = otherStill?.open === true;
	verdict.check(
		"other still",
		otherUp,
		otherUp
			? "other still reports open: true while main is closed"
			: `answered ${show(byTag.get("otherstill"))}`,
	);
}
