/**
 * The transition itself: the plugin's flag, the style-mask bit on the live window, the page's own
 * viewport against the display, and the Space it lands on. Then the same three reads after leaving.
 */
import type { Verdict } from "../../e2e-harness.ts";
import { type PageAnswer, resolved, show } from "../../window/answers.ts";
import { probeOf, screenfulOf, transitionOf } from "../answers.ts";
import { COVER_TOLERANCE, STYLE_MASK_FULLSCREEN } from "../expectations.ts";
import { probeDetail, readOf } from "./describe.ts";

export function checkTransition(verdict: Verdict, byTag: Map<string, PageAnswer>): void {
	// ---- 4. a real fullscreen transition completes ------------------------
	const launch = screenfulOf(byTag.get("viewport0"));
	const entered = transitionOf(byTag.get("fs"));
	const enteredFlag = entered === undefined ? undefined : entered.settled;
	const wentFullscreen = entered?.reached === true && resolved(enteredFlag)?.fullscreen === true;
	verdict.check(
		"enters fullscreen",
		wentFullscreen,
		entered === undefined
			? readOf(byTag.get("fs"), "transition")
			: `reached ${entered.reached} after ${entered.elapsedMs} ms, ` +
					`isFullscreen answered ${show(enteredFlag)}`,
	);

	const during = probeOf(byTag.get("probe1"));
	const maskSet = during !== undefined && (during.styleMask & STYLE_MASK_FULLSCREEN) !== 0;
	verdict.check(
		"style mask fs",
		maskSet,
		during === undefined
			? readOf(byTag.get("probe1"), "fullscreen")
			: probeDetail(during, "fullscreen"),
	);

	const covered =
		entered !== undefined &&
		entered.viewport.height >= entered.screen.availHeight - COVER_TOLERANCE &&
		entered.viewport.width >= entered.screen.width - COVER_TOLERANCE;
	verdict.check(
		"covers display",
		covered,
		entered === undefined
			? readOf(byTag.get("fs"), "transition")
			: `the page reports ${entered.viewport.width}x${entered.viewport.height} on a ` +
					`${entered.screen.width}x${entered.screen.height} display, ` +
					`${entered.screen.availHeight} pt usable in fullscreen`,
	);

	// A zoomed window stops at the windowed visible frame (840 pt here, under the menu bar and dock),
	// so that frame is what a zoom can reach. When the display reserves nothing in the windowed state
	// the two coincide and this measurement cannot tell them apart — said out loud, never passed
	// silently, and never the only evidence: the style-mask bit is the definitive read.
	const reserved = launch === undefined ? 0 : launch.screen.height - launch.screen.availHeight;
	const aboveFrame =
		entered !== undefined &&
		launch !== undefined &&
		entered.viewport.height > launch.screen.availHeight + COVER_TOLERANCE;
	const discriminative = reserved > COVER_TOLERANCE;
	verdict.check(
		"above visible frame",
		!discriminative || aboveFrame,
		discriminative
			? `the page reports ${entered?.viewport.height} against a ${launch?.screen.availHeight} pt ` +
					`windowed visible frame (display ${launch?.screen.height}, ${reserved} pt reserved)`
			: `this display reserves ${reserved} pt, so a zoom and fullscreen are the same height here`,
	);

	const stillOnSpace = during?.onActiveSpace === 1;
	verdict.check(
		"space after enter",
		stillOnSpace,
		during === undefined
			? readOf(byTag.get("probe1"), "fullscreen")
			: `-isOnActiveSpace answered ${during.onActiveSpace} inside fullscreen`,
	);

	// ---- 5. it leaves again, and the flag is not sticky -------------------
	const left = transitionOf(byTag.get("unfs"));
	const leftFlag = left === undefined ? undefined : left.settled;
	const wentWindowed = left?.reached === true && resolved(leftFlag)?.fullscreen === false;
	verdict.check(
		"leaves fullscreen",
		wentWindowed,
		left === undefined
			? readOf(byTag.get("unfs"), "transition")
			: `reached ${left.reached} after ${left.elapsedMs} ms, isFullscreen answered ${show(leftFlag)}`,
	);

	const after = probeOf(byTag.get("probe2"));
	const maskClear = after !== undefined && (after.styleMask & STYLE_MASK_FULLSCREEN) === 0;
	verdict.check(
		"mask cleared",
		maskClear,
		after === undefined
			? readOf(byTag.get("probe2"), "windowed")
			: probeDetail(after, "windowed"),
	);

	const back = screenfulOf(byTag.get("viewport2"));
	// Back to the size it opened at, not merely "less than the display": the fullscreen height here is
	// 923 pt against a 956 pt panel, so a comparison with the panel would call a stuck window restored.
	const restored =
		back !== undefined &&
		launch !== undefined &&
		back.viewport.height <= launch.viewport.height + COVER_TOLERANCE;
	verdict.check(
		"viewport restored",
		restored,
		back === undefined || launch === undefined
			? readOf(byTag.get("viewport2"), "windowed")
			: `the page reports ${back.viewport.width}x${back.viewport.height} again, ` +
					`from an opening ${launch.viewport.width}x${launch.viewport.height}`,
	);
}
