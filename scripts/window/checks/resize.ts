/**
 * The page follows its window. A resize the window takes and the page does not is what "apps can't be
 * resized" looked like: the webview stayed at the size the window opened at, so the page area never
 * changed. The page reports its own viewport, so a size it never sees is the defect — and both
 * directions are asked for, because a one-way constraint passes growing alone.
 */
import type { Verdict } from "../../e2e-harness.ts";
import { type PageAnswer, resolved, show } from "../answers.ts";
import { LARGER, OPENING, SMALLER } from "../fixture/config.ts";

/**
 * The titlebar is the only chrome between a window's frame and its page, and `window.setSize` sets the
 * frame: 32 pt measured, and the allowance leaves room for a taller bar without letting a frozen page
 * through. The width has no side chrome, so it is exact.
 */
const TITLEBAR = 60;

type Size = { width: number; height: number };

/** A viewport answer's two numbers, or undefined when the page did not report them. */
function viewportOf(answer: PageAnswer | undefined): Size | undefined {
	const value = resolved(answer);
	const width = value?.width;
	const height = value?.height;
	if (typeof width !== "number" || typeof height !== "number") return undefined;
	return { width, height };
}

/** Whether the page's viewport is the frame that was asked for, allowing for the titlebar. */
function followed(view: Size | undefined, size: Size): boolean {
	if (view === undefined) return false;
	return (
		view.width === size.width &&
		view.height <= size.height &&
		view.height >= size.height - TITLEBAR
	);
}

export function checkResize(verdict: Verdict, byTag: Map<string, PageAnswer>): void {
	// The opening size, as the config asked for it: this is what makes the two resizes below a change
	// of a known size rather than a change from whatever the page happened to see.
	const initial = viewportOf(byTag.get("viewport0"));
	const opened = followed(initial, OPENING);
	verdict.check(
		"viewport initial",
		opened,
		opened
			? `the page reports its configured ${initial?.width}x${initial?.height}`
			: `config asks for ${OPENING.width}x${OPENING.height}, page saw ${show(byTag.get("viewport0"))}`,
	);

	const large = viewportOf(byTag.get("resizelarge"));
	const grew = followed(large, LARGER);
	verdict.check(
		"resize larger",
		grew,
		grew
			? `asked for ${LARGER.width}x${LARGER.height}, the page reports ${large?.width}x${large?.height}`
			: `asked for ${LARGER.width}x${LARGER.height}, page saw ${show(byTag.get("resizelarge"))}`,
	);

	const small = viewportOf(byTag.get("resizesmall"));
	const shrank = followed(small, SMALLER);
	verdict.check(
		"resize smaller",
		shrank,
		shrank
			? `asked for ${SMALLER.width}x${SMALLER.height}, the page reports ${small?.width}x${small?.height}`
			: `asked for ${SMALLER.width}x${SMALLER.height}, page saw ${show(byTag.get("resizesmall"))}`,
	);
}
