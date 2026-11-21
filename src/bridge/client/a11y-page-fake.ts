/**
 * The fake DOM behind `a11y-page.test.ts`: only what the injected page commands read —
 * `querySelector`, `getElementById`, `textContent`, attributes, children, focus and shadow roots.
 * The snippet under test is still evaluated with `new Function`, so nothing here is imported by it.
 */
import type { PageA11y } from "./a11y-page-types.ts";
import { bootstrapSource, pageClientSource } from "./bootstrap.ts";

/** A shadow root: no tagName, so the page tree walks its children without listing a fake node. */
export class FakeShadow {
	readonly children: FakeEl[] = [];
	activeElement: FakeEl | null = null;
	constructor(readonly host: FakeEl) {}
}

export class FakeEl {
	readonly tagName: string;
	private readonly attrs: Record<string, string>;
	readonly children: FakeEl[] = [];
	textContent = "";
	doc?: FakeDoc;
	shadowRoot?: FakeShadow;
	host?: FakeEl;

	constructor(tag: string, attrs: Record<string, string> = {}, text = "") {
		this.tagName = tag;
		this.attrs = attrs;
		this.textContent = text;
	}

	getAttribute(name: string): string | null {
		return Object.prototype.hasOwnProperty.call(this.attrs, name)
			? (this.attrs[name] ?? null)
			: null;
	}

	append(...kids: FakeEl[]): FakeEl {
		this.children.push(...kids);
		return this;
	}

	/** A web component: its shadow subtree is part of the page but not of `children`. */
	attach(...kids: FakeEl[]): FakeShadow {
		this.shadowRoot = new FakeShadow(this);
		this.shadowRoot.children.push(...kids);
		for (const kid of kids) kid.host = this;
		return this.shadowRoot;
	}

	focus(): void {
		if (!this.doc) return;
		// A real browser refuses focus() on a div with no tabindex. The stub must do the same or it
		// would hide the refusal the command is meant to report.
		const tag = this.tagName.toLowerCase();
		const native =
			tag === "button" ||
			tag === "input" ||
			tag === "select" ||
			tag === "textarea" ||
			(tag === "a" && this.getAttribute("href") !== null) ||
			this.getAttribute("contenteditable") === "true";
		const ti = this.getAttribute("tabindex");
		if (!native && (ti === null || Number(ti) < 0)) return;
		if (this.host?.shadowRoot) {
			// `document.activeElement` reports the host; the shadow root reports the real node.
			this.host.shadowRoot.activeElement = this;
			this.doc.activeElement = this.host;
			return;
		}
		this.doc.activeElement = this;
	}
}

export class FakeDoc {
	readonly body: FakeEl;
	activeElement: FakeEl | null = null;
	private readonly ids = new Map<string, FakeEl>();

	constructor(body: FakeEl) {
		this.body = body;
		this.register(body);
	}

	private register(el: FakeEl): void {
		el.doc = this;
		const id = el.getAttribute("id");
		if (id) this.ids.set(id, el);
		for (const kid of el.children) this.register(kid);
		const shadow = el.shadowRoot;
		if (shadow) for (const kid of shadow.children) this.register(kid);
	}

	getElementById(id: string): FakeEl | null {
		return this.ids.get(id) ?? null;
	}

	querySelector(selector: string): FakeEl | null {
		const all: FakeEl[] = [];
		const gather = (el: FakeEl) => {
			all.push(el);
			for (const kid of el.children) gather(kid);
			const shadow = el.shadowRoot;
			if (shadow) for (const kid of shadow.children) gather(kid);
		};
		gather(this.body);
		const sel = selector.trim();
		if (sel.startsWith("#"))
			return all.find((el) => el.getAttribute("id") === sel.slice(1)) ?? null;
		if (sel.startsWith("."))
			return (
				all.find((el) =>
					(el.getAttribute("class") ?? "").split(/\s+/).includes(sel.slice(1)),
				) ?? null
			);
		return all.find((el) => el.tagName.toLowerCase() === sel.toLowerCase()) ?? null;
	}
}

/** A page with a heading, a labelled button, an image and an unfocusable div. */
export function pageDocument(): FakeDoc {
	const heading = new FakeEl("h1", { id: "title" }, "Quarterly report");
	const save = new FakeEl("button", { id: "save", "aria-label": "Save report" }, "Save");
	const logo = new FakeEl("img", { alt: "Crust" });
	const box = new FakeEl("div", { id: "box" }, "Not a control");
	const main = new FakeEl("main").append(heading, save, logo, box);
	return new FakeDoc(main);
}

/** A page whose only control lives inside a custom element's shadow root. */
export function shadowDocument(): FakeDoc {
	const inner = new FakeEl("button", { id: "inner", "aria-label": "Inner action" }, "Go");
	const host = new FakeEl("my-widget", { id: "host" }, "Widget");
	host.attach(inner);
	const main = new FakeEl("main").append(host);
	return new FakeDoc(main);
}

export function install(source: "served" | "dev", document: FakeDoc): { a11y?: PageA11y } {
	const snippet =
		source === "served"
			? bootstrapSource({ baseUrl: "http://127.0.0.1:1", token: "t", port: 1 })
			: pageClientSource();
	const target: Record<string, any> = { document };
	if (source === "dev") target.__CRUST__ = { url: "http://127.0.0.1:1", token: "t" };
	const factory = new Function("window", "location", `return ${snippet};`) as (
		scope: Record<string, any>,
		location: { search: string },
	) => { a11y?: PageA11y };
	return factory(target, { search: "?token=t" });
}
