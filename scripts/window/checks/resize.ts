/**
 * The page follows its window. A resize the window takes and the page does not is what "apps can't be
 * resized" looked like: the webview stayed at the size the window opened at, so the page area never
 * changed. The page reports its own viewport, so a size it never sees is the defect — and both
 * directions are asked for, because a one-way constraint passes growing alone.
 *
 * The comparison is against the frame the window *reports*, not the number that was requested: a
 * runner's display can clamp `setSize`, and a proof that assumes the request was granted fails for a
 * reason that has nothing to do with the page. The frame also has to have moved, so a `setSize` that
 * did nothing cannot pass on a page that never changed either.
 */
import type { Verdict } from "../../e2e-harness.ts";
import { type PageAnswer, resolved, show } from "../answers.ts";
import { OPENING, TITLEBAR } from "../fixture/config.ts";

type Size = { width: number; height: number };

/** One resize answer's three observations, or undefined when the page did not report them. */
interface Resize {
	requested: Size;
	frame: Size;
	viewport: Size;
}

function sizeIn(value: unknown): Size | undefined {
	if (typeof value !== "object" || value === null) return undefined;
	const { width, height } = value as { width?: unknown; height?: unknown };
	if (typeof width !== "number" || typeof height !== "number") return undefined;
	return { width, height };
}

/** The window's own frame from a `getSize` answer. */
function frameOf(answer: PageAnswer | undefined): Size | undefined {
	return sizeIn(resolved(answer));
}

/** A `resize` answer: what was asked for, the frame granted, and what the page saw. */
function resizeOf(answer: PageAnswer | undefined): Resize | undefined {
	const value = resolved(answer);
	if (value === undefined) return undefined;
	const requested = sizeIn(value.requested);
	const frame = sizeIn(value.frame);
	const viewport = sizeIn(value.viewport);
	if (requested === undefined || frame === undefined || viewport === undefined) return undefined;
	return { requested, frame, viewport };
}

/** Whether the page's viewport is the frame the window took, allowing for the titlebar. */
function follows(view: Size | undefined, frame: Size | undefined): boolean {
	if (view === undefined || frame === undefined) return false;
	return (
		view.width === frame.width &&
		view.height <= frame.height &&
		view.height >= frame.height - TITLEBAR
	);
}

function showSize(size: Size | undefined): string {
	return size === undefined ? "no size" : `${size.width}x${size.height}`;
}

export function checkResize(verdict: Verdict, byTag: Map<string, PageAnswer>): void {
	// The opening size: the page must agree with the frame the window opened at, which is also what the
	// config asked for — recorded rather than assumed, so a clamped opening is visible in the detail.
	const openingFrame = frameOf(byTag.get("frame0"));
	const openingView = sizeIn(resolved(byTag.get("viewport0")));
	const opened = follows(openingView, openingFrame);
	verdict.check(
		"viewport initial",
		opened,
		opened
			? `the page reports ${showSize(openingView)} for a ${showSize(openingFrame)} window` +
					(openingFrame?.width === OPENING.width && openingFrame.height === OPENING.height
						? ""
						: ` (config asked for ${showSize(OPENING)})`)
			: `the window is ${showSize(openingFrame)}, page saw ${show(byTag.get("viewport0"))}`,
	);

	const large = resizeOf(byTag.get("resizelarge"));
	const grew =
		follows(large?.viewport, large?.frame) &&
		large !== undefined &&
		openingFrame !== undefined &&
		large.frame.width > openingFrame.width;
	verdict.check(
		"resize larger",
		grew,
		large === undefined
			? `page saw ${show(byTag.get("resizelarge"))}`
			: `asked for ${showSize(large.requested)}, the window took ${showSize(large.frame)}, ` +
					`the page reports ${showSize(large.viewport)}`,
	);

	const small = resizeOf(byTag.get("resizesmall"));
	const shrank =
		follows(small?.viewport, small?.frame) &&
		small !== undefined &&
		large !== undefined &&
		small.frame.width < large.frame.width;
	verdict.check(
		"resize smaller",
		shrank,
		small === undefined
			? `page saw ${show(byTag.get("resizesmall"))}`
			: `asked for ${showSize(small.requested)}, the window took ${showSize(small.frame)}, ` +
					`the page reports ${showSize(small.viewport)}`,
	);
}
