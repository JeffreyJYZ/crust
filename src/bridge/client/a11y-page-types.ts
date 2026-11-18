/**
 * Result and argument shapes for the page half of `crust:accessibility`. Split from `a11y-page.ts`
 * at the type-contract boundary so the injected implementation file stays under the 200-line cap:
 * these declarations are erased before `installPageA11y.toString()` becomes the page's copy, so the
 * split changes nothing the page receives.
 */

/** One element as the DOM reports it. `readingOrder` is a depth-first index from the root. */
export interface A11yNode {
	role: string;
	label: string;
	focusable: boolean;
	readingOrder: number;
}

export interface PageA11yRefusal {
	ok: false;
	code: "no-document" | "not-found" | "bad-request" | "not-focusable" | "handler-error";
	message: string;
}

export interface PageTreeResult {
	ok: true;
	source: "dom";
	/** The distinction a caller must not lose: DOM structure is not the OS accessibility tree. */
	note: string;
	root: string;
	nodes: A11yNode[];
}

export interface PageFocusResult {
	ok: true;
	selector: string;
	focused: true;
	/** What actually took focus, described the same way a tree node is. */
	active: { role: string; label: string };
}

export type PageTreeAnswer = PageTreeResult | PageA11yRefusal;
export type PageFocusAnswer = PageFocusResult | PageA11yRefusal;

export interface PageA11y {
	pageTree(selector?: string): PageTreeAnswer;
	focusElement(selector: string): PageFocusAnswer;
}
