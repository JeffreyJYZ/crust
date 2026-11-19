/**
 * `crust:testing`'s reading commands against the fake page: `click`, `clickAt`, `query`, `waitFor`
 * and the refusals. Nothing here opens a window — the fake runs the plugin's real scripts, so the
 * shapes, the codes and the timeout are all proven on the code that ships.
 */

import { describe, expect, test } from "bun:test";

import { createTestingPlugin } from "./testing";
import { FakeElement } from "./testing-fake";
import { testPage } from "./testing-fixture";

describe("click", () => {
	test("scrolls the element into view, focuses it and clicks it", async () => {
		const fake = testPage();
		const answer = await createTestingPlugin(fake.adapter).commands.click({ selector: "#go" });
		expect(answer).toEqual({ ok: true, clicked: true });
		expect(fake.button.clicks).toBe(1);
		expect(fake.button.scrolls).toBe(1);
		expect(fake.button.focused).toBe(true);
	});

	test("a selector that matches nothing is `not-found`", async () => {
		const fake = testPage();
		const answer = await createTestingPlugin(fake.adapter).commands.click({ selector: "#nope" });
		expect(answer).toEqual({ ok: false, code: "not-found", message: "no element matches #nope" });
	});

	test("clickAt clicks whatever is painted at the point", async () => {
		const fake = testPage();
		const answer = await createTestingPlugin(fake.adapter).commands.clickAt({ x: 20, y: 20 });
		expect(answer).toEqual({ ok: true, clicked: true });
		expect(fake.button.clicks).toBe(1);
	});

	test("clickAt with nothing under the point is `not-found`", async () => {
		const fake = testPage();
		const answer = await createTestingPlugin(fake.adapter).commands.clickAt({ x: 500, y: 500 });
		expect("code" in answer && answer.code).toBe("not-found");
	});
});

describe("query", () => {
	test("reads presence, visibility, geometry, value and attributes", async () => {
		const fake = testPage();
		const answer = await createTestingPlugin(fake.adapter).commands.query({
			selector: "#name",
		});
		expect(answer).toMatchObject({
			ok: true,
			exists: true,
			visible: true,
			rect: { x: 10, y: 60, width: 200, height: 24 },
			value: "",
			attributes: { id: "name" },
		});
	});

	test("an absent element is an answer, not a refusal", async () => {
		const fake = testPage();
		const answer = await createTestingPlugin(fake.adapter).commands.query({
			selector: "#nope",
		});
		expect(answer).toEqual({
			ok: true,
			exists: false,
			visible: false,
			rect: { x: 0, y: 0, width: 0, height: 0 },
			text: "",
			value: null,
			attributes: {},
		});
	});

	test("a display:none element exists but is not visible", async () => {
		const fake = testPage();
		fake.box.style.display = "none";
		const answer = await createTestingPlugin(fake.adapter).commands.query({ selector: "#box" });
		expect(answer).toMatchObject({ ok: true, exists: true, visible: false, text: "boxed" });
	});
});

describe("waitFor", () => {
	test("resolves once the element appears", async () => {
		const fake = testPage();
		setTimeout(() => {
			fake.document.body.append(new FakeElement("span", { id: "late" }));
		}, 60);
		const answer = await createTestingPlugin(fake.adapter).commands.waitFor({
			selector: "#late",
			timeoutMs: 1000,
		});
		expect(answer).toMatchObject({ ok: true, found: true });
	});

	test("times out as `not-found`, naming the wait", async () => {
		const fake = testPage();
		const answer = await createTestingPlugin(fake.adapter).commands.waitFor({
			selector: "#never",
			timeoutMs: 120,
		});
		expect("code" in answer && answer.code).toBe("not-found");
		expect("message" in answer && answer.message).toContain("did not appear within 120 ms");
	});
});

describe("refusals", () => {
	test("no adapter answers `not-implemented` naming the WebKit call", async () => {
		const answer = await createTestingPlugin().commands.click({ selector: "#go" });
		expect("code" in answer && answer.code).toBe("not-implemented");
		expect("requires" in answer && answer.requires).toContain("evaluateJavaScript");
	});

	test("a label naming no window keeps its `unknown-window` code", async () => {
		const fake = testPage();
		const answer = await createTestingPlugin(fake.adapter).commands.query({
			selector: "#go",
			label: "other",
		});
		expect("code" in answer && answer.code).toBe("unknown-window");
	});

	test("an empty selector is the caller's bug, not a page failure", async () => {
		const fake = testPage();
		expect(createTestingPlugin(fake.adapter).commands.click({ selector: "" })).rejects.toThrow(
			"selector",
		);
	});
});
