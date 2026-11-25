/**
 * The page's own view of its DOM: `pageTree` and `focusElement`, installed on `window.crust.a11y`.
 *
 * This is the web half the OS cannot give us. `accessibility.elementCount` walks the app's AX
 * element in a process that is not trusted by default, so it says nothing about web content — and
 * reading another process's tree needs a trust this app does not have. These two commands do not
 * cross the bridge and do not call a native half: they read and focus the DOM the page already owns.
 * The `note` on a tree answer keeps that distinction explicit — a green tree is the DOM's report,
 * not evidence that a screen reader can reach the page.
 *
 * Serialised with `Function.prototype.toString()` beside `installInvoke`, so everything it needs
 * lives inside this function or in the helper factory passed in; types are erased before the page
 * sees the source, and no runtime value may come from module scope.
 */
import type { A11yNode, PageA11y, PageFocusAnswer, PageTreeAnswer } from "./a11y-page-types.ts";
import type { A11yHelpers } from "./a11y-helpers.ts";

export function installPageA11y(scope: Record<string, any>, helpers: A11yHelpers): PageA11y {
	const { doc, tagOf, roleOf, labelOf, describe, noDocument, badSelector } = helpers;
	const domNote =
		"This is the page's own view of its DOM, not the operating system's accessibility tree; " +
		"it does not prove a screen reader can reach the page.";

	return {
		pageTree(selector?: string): PageTreeAnswer {
			const d = doc();
			if (!d || typeof d.querySelector !== "function") return noDocument("pageTree");
			const rootSelector =
				typeof selector === "string" && selector.trim() ? selector.trim() : "body";
			let root: any;
			try {
				root =
					rootSelector === "body"
						? (d.body ?? d.querySelector("body"))
						: d.querySelector(rootSelector);
			} catch (error) {
				return badSelector("pageTree", rootSelector, error);
			}
			if (!root) {
				return {
					ok: false,
					code: "not-found",
					message: `a11y.pageTree: no element matches ${rootSelector}`,
				};
			}
			const nodes: A11yNode[] = [];
			let order = 0;
			const walk = (el: any): void => {
				// A shadow root is a fragment with no role: walk its children so web components appear,
				// but invent no row for the boundary itself.
				if (tagOf(el)) nodes.push(describe(el, order++));
				for (const source of [el, el?.shadowRoot]) {
					const kids = source?.children ?? source?.childNodes;
					for (let i = 0; kids && i < kids.length; i++) walk(kids[i]);
				}
			};
			walk(root);
			return { ok: true, source: "dom", note: domNote, root: rootSelector, nodes };
		},
		focusElement(selector: string): PageFocusAnswer {
			const d = doc();
			if (!d || typeof d.querySelector !== "function") return noDocument("focusElement");
			const sel = typeof selector === "string" ? selector.trim() : "";
			if (!sel) {
				return {
					ok: false,
					code: "bad-request",
					message: "a11y.focusElement needs a non-empty selector",
				};
			}
			let el: any;
			try {
				el = d.querySelector(sel);
			} catch (error) {
				return badSelector("focusElement", sel, error);
			}
			if (!el) {
				return {
					ok: false,
					code: "not-found",
					message: `a11y.focusElement: no element matches ${sel}`,
				};
			}
			let called = true;
			try {
				if (typeof el.focus === "function") el.focus();
				else called = false;
			} catch (error) {
				return {
					ok: false,
					code: "handler-error",
					message: `a11y.focusElement: focus() threw — ${error instanceof Error ? error.message : String(error)}`,
				};
			}
			// `document.activeElement` returns the shadow HOST for a node inside a shadow tree; follow
			// each host's shadowRoot.activeElement to the node that actually took focus before
			// deciding the element was not focusable.
			let active = d.activeElement;
			for (let depth = 0; active?.shadowRoot?.activeElement && depth < 32; depth++)
				active = active.shadowRoot.activeElement;
			if (active !== el) {
				return {
					ok: false,
					code: "not-focusable",
					message:
						`a11y.focusElement: ${called ? "focus() was called but nothing took focus" : "the element has no focus()"} ` +
						`for ${sel}; a browser only focuses natively focusable elements or ones with tabindex`,
				};
			}
			return {
				ok: true,
				selector: sel,
				focused: true,
				active: { role: roleOf(active), label: labelOf(active) },
			};
		},
	};
}
