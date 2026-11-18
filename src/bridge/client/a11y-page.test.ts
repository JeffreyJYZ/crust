/**
 * The page half of `crust:accessibility`, exercised through the injected bytes a page receives.
 *
 * A small fake DOM supplies only what the commands read: `querySelector`, `getElementById`,
 * `textContent`, attributes, children and `focus()`. Nothing here imports a parallel copy of the
 * implementation — the snippet is evaluated with `new Function` exactly as `installPage` does, so
 * a module-scope reference in the serialised function would surface as a failure here.
 */
import { describe, expect, test } from "bun:test";
import type { PageA11y } from "./a11y-page-types.ts";
import { bootstrapSource, pageClientSource } from "./bootstrap.ts";

class FakeEl {
	readonly tagName: string;
	private readonly attrs: Record<string, string>;
	readonly children: FakeEl[] = [];
	textContent = "";
	doc?: FakeDoc;

	constructor(tag: string, attrs: Record<string, string> = {}, text = "") {
		this.tagName = tag;
		this.attrs = attrs;
		this.textContent = text;
	}

	getAttribute(name: string): string | null {
		return Object.prototype.hasOwnProperty.call(this.attrs, name) ? (this.attrs[name] ?? null) : null;
	}

	append(...kids: FakeEl[]): FakeEl {
		this.children.push(...kids);
		return this;
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
		this.doc.activeElement = this;
	}
}

class FakeDoc {
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
	}

	getElementById(id: string): FakeEl | null {
		return this.ids.get(id) ?? null;
	}

	querySelector(selector: string): FakeEl | null {
		const all: FakeEl[] = [];
		const gather = (el: FakeEl) => {
			all.push(el);
			for (const kid of el.children) gather(kid);
		};
		gather(this.body);
		const sel = selector.trim();
		if (sel.startsWith("#")) return all.find((el) => el.getAttribute("id") === sel.slice(1)) ?? null;
		if (sel.startsWith("."))
			return all.find((el) => (el.getAttribute("class") ?? "").split(/\s+/).includes(sel.slice(1))) ?? null;
		return all.find((el) => el.tagName.toLowerCase() === sel.toLowerCase()) ?? null;
	}
}

/** A page with a heading, a labelled button, an image and an unfocusable div. */
function pageDocument(): FakeDoc {
	const heading = new FakeEl("h1", { id: "title" }, "Quarterly report");
	const save = new FakeEl("button", { id: "save", "aria-label": "Save report" }, "Save");
	const logo = new FakeEl("img", { alt: "Crust" });
	const box = new FakeEl("div", { id: "box" }, "Not a control");
	const main = new FakeEl("main").append(heading, save, logo, box);
	return new FakeDoc(main);
}

function install(source: "served" | "dev", document: FakeDoc): { a11y?: PageA11y } {
	const snippet = source === "served"
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

describe("crust.a11y.pageTree", () => {
	test("returns role, label, focusability and reading order for a known subtree", () => {
		for (const source of ["served", "dev"] as const) {
			const result = install(source, pageDocument()).a11y!.pageTree();
			expect(result.ok).toBe(true);
			if (!result.ok) return;
			expect(result.source).toBe("dom");
			expect(result.root).toBe("body");
			expect(result.nodes.map((node) => node.role)).toEqual([
				"main", "heading", "button", "img", "generic",
			]);
			const heading = result.nodes.find((node) => node.role === "heading")!;
			expect(heading.label).toBe("Quarterly report");
			expect(heading.focusable).toBe(false);
			expect(heading.readingOrder).toBe(1);
			const button = result.nodes.find((node) => node.role === "button")!;
			expect(button.label).toBe("Save report");
			expect(button.focusable).toBe(true);
			expect(button.readingOrder).toBe(2);
			expect(result.nodes.find((node) => node.role === "img")!.label).toBe("Crust");
		}
	});

	test("keeps the honest note that this is the DOM, not the OS tree", () => {
		const result = install("served", pageDocument()).a11y!.pageTree("#title");
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.note).toContain("not the operating system's accessibility tree");
		expect(result.root).toBe("#title");
		expect(result.nodes).toHaveLength(1);
	});

	test("refuses a selector that matches nothing", () => {
		const result = install("served", pageDocument()).a11y!.pageTree("#missing");
		expect(result).toMatchObject({ ok: false, code: "not-found" });
		if (result.ok) return;
		expect(result.message).toContain("#missing");
	});
});

describe("crust.a11y.focusElement", () => {
	test("moves focus and reports what actually took it", () => {
		const doc = pageDocument();
		const result = install("served", doc).a11y!.focusElement("#save");
		expect(result).toMatchObject({ ok: true, focused: true, selector: "#save" });
		expect(doc.activeElement?.getAttribute("id")).toBe("save");
		if (!result.ok) return;
		expect(result.active).toEqual({ role: "button", label: "Save report" });
	});

	test("refuses a div without tabindex and names the reason", () => {
		const doc = pageDocument();
		const result = install("served", doc).a11y!.focusElement("#box");
		expect(result).toMatchObject({ ok: false, code: "not-focusable" });
		if (result.ok) return;
		expect(result.message).toContain("tabindex");
		expect(doc.activeElement).toBeNull();
	});

	test("refuses an empty or unmatched selector", () => {
		const a11y = install("served", pageDocument()).a11y!;
		expect(a11y.focusElement("  ")).toMatchObject({ ok: false, code: "bad-request" });
		expect(a11y.focusElement("#missing")).toMatchObject({ ok: false, code: "not-found" });
	});
});
