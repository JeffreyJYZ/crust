/**
 * The page half of `crust:accessibility`, exercised through the injected bytes a page receives.
 *
 * The fake DOM lives in `a11y-page-fake.ts` so this file holds only the proofs. Nothing here imports
 * a parallel copy of the implementation — the snippet is evaluated with `new Function` exactly as
 * `installPage` does, so a module-scope reference in the serialised function would surface here.
 */
import { describe, expect, test } from "bun:test";
import { install, pageDocument, shadowDocument } from "./a11y-page-fake.ts";

describe("crust.a11y.pageTree", () => {
	test("returns role, label, focusability and reading order for a known subtree", () => {
		for (const source of ["served", "dev"] as const) {
			const result = install(source, pageDocument()).a11y!.pageTree();
			expect(result.ok).toBe(true);
			if (!result.ok) return;
			expect(result.source).toBe("dom");
			expect(result.root).toBe("body");
			expect(result.nodes.map((node) => node.role)).toEqual([
				"main",
				"heading",
				"button",
				"img",
				"generic",
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

	test("walks into a shadow root instead of hiding web component content", () => {
		const result = install("served", shadowDocument()).a11y!.pageTree();
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		// The host and its inner button are both present; no fake row is invented for the fragment.
		expect(result.nodes.map((node) => node.label)).toEqual(["", "Widget", "Inner action"]);
		expect(result.nodes[2]).toMatchObject({ role: "button", focusable: true });
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

	test("reports focus that landed inside a shadow root, whose host is the document's activeElement", () => {
		const doc = shadowDocument();
		const result = install("served", doc).a11y!.focusElement("#inner");
		expect(result).toMatchObject({ ok: true, focused: true, selector: "#inner" });
		expect(doc.activeElement?.getAttribute("id")).toBe("host");
		if (!result.ok) return;
		expect(result.active).toEqual({ role: "button", label: "Inner action" });
	});

	test("refuses an empty or unmatched selector", () => {
		const a11y = install("served", pageDocument()).a11y!;
		expect(a11y.focusElement("  ")).toMatchObject({ ok: false, code: "bad-request" });
		expect(a11y.focusElement("#missing")).toMatchObject({ ok: false, code: "not-found" });
	});

	test("a selector the browser refuses to parse is bad-request, not a thrown DOMException", () => {
		const doc = pageDocument();
		(doc as any).querySelector = () => {
			throw new DOMException("Invalid selector", "SyntaxError");
		};
		const a11y = install("served", doc).a11y!;
		for (const answer of [a11y.pageTree("["), a11y.focusElement("[")]) {
			expect(answer).toMatchObject({
				ok: false,
				code: "bad-request",
				message: expect.stringContaining("Invalid selector"),
			});
		}
	});
});
