/**
 * The DOM-description helpers behind `window.crust.a11y`, split out of `a11y-page.ts` for the
 * 200-line cap. This factory is injected as source, so every runtime value it uses comes from its
 * own argument list; the type imports below are erased before it reaches the page.
 */
import type { A11yNode, PageA11yRefusal } from "./a11y-page-types.ts";

export interface A11yHelpers {
	doc(): any;
	attr(el: any, name: string): string;
	text(el: any): string;
	tagOf(el: any): string;
	roleOf(el: any): string;
	labelOf(el: any): string;
	focusableOf(el: any): boolean;
	describe(el: any, order: number): A11yNode;
	noDocument(command: string): PageA11yRefusal;
	badSelector(command: string, selector: string, error: unknown): PageA11yRefusal;
}

export function installA11yHelpers(scope: Record<string, any>): A11yHelpers {
	const doc = (): any => scope.document;
	const attr = (el: any, name: string): string => {
		const get = el?.getAttribute;
		const value = typeof get === "function" ? get.call(el, name) : null;
		return typeof value === "string" ? value : "";
	};
	const text = (el: any): string => {
		const value = el?.textContent;
		return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
	};
	const tagOf = (el: any): string => String(el?.tagName ?? el?.nodeName ?? "").toLowerCase();
	const roleOf = (el: any): string => {
		const explicit = attr(el, "role");
		if (explicit) return explicit;
		const tag = tagOf(el);
		if (tag === "a") return attr(el, "href") ? "link" : "generic";
		if (tag === "button") return "button";
		if (tag === "input") {
			const type = attr(el, "type").toLowerCase();
			if (type === "checkbox") return "checkbox";
			if (type === "radio") return "radio";
			if (type === "button" || type === "submit" || type === "reset") return "button";
			return "textbox";
		}
		if (tag === "select") return "combobox";
		if (tag === "textarea") return "textbox";
		if (tag === "img") return "img";
		if (/^h[1-6]$/.test(tag)) return "heading";
		if (tag === "nav") return "navigation";
		if (tag === "main") return "main";
		if (tag === "ul" || tag === "ol") return "list";
		if (tag === "li") return "listitem";
		if (tag === "table") return "table";
		if (tag === "dialog") return "dialog";
		if (tag === "div" || tag === "span") return "generic";
		return tag || "generic";
	};
	const labelOf = (el: any): string => {
		const aria = attr(el, "aria-label");
		if (aria) return aria;
		const by = attr(el, "aria-labelledby");
		if (by) {
			const parts: string[] = [];
			for (const id of by.split(/\s+/)) {
				const d = doc();
				const ref =
					id && typeof d?.getElementById === "function" ? d.getElementById(id) : null;
				if (ref) parts.push(text(ref));
			}
			const joined = parts.filter(Boolean).join(" ");
			if (joined) return joined;
		}
		const alt = attr(el, "alt");
		if (alt) return alt;
		const title = attr(el, "title");
		if (title) return title;
		return text(el).slice(0, 120);
	};
	const focusableOf = (el: any): boolean => {
		const ti = attr(el, "tabindex");
		if (ti !== "") {
			const n = Number(ti);
			return Number.isFinite(n) && n >= 0;
		}
		const tag = tagOf(el);
		if (tag === "a") return attr(el, "href") !== "";
		return (
			tag === "button" ||
			tag === "input" ||
			tag === "select" ||
			tag === "textarea" ||
			attr(el, "contenteditable") === "true"
		);
	};
	const describe = (el: any, order: number): A11yNode => ({
		role: roleOf(el),
		label: labelOf(el),
		focusable: focusableOf(el),
		readingOrder: order,
	});
	const noDocument = (command: string): PageA11yRefusal => ({
		ok: false,
		code: "no-document",
		message: `a11y.${command}: this page has no document to read or focus`,
	});
	// `querySelector` throws SyntaxError for a selector the browser cannot parse. That is a bad
	// request, not an uncaught DOMException escaping the page API.
	const badSelector = (command: string, selector: string, error: unknown): PageA11yRefusal => ({
		ok: false,
		code: "bad-request",
		message: `a11y.${command}: invalid selector ${JSON.stringify(selector)}: ${
			error instanceof Error ? error.message : String(error)
		}`,
	});
	return {
		doc,
		attr,
		text,
		tagOf,
		roleOf,
		labelOf,
		focusableOf,
		describe,
		noDocument,
		badSelector,
	};
}
