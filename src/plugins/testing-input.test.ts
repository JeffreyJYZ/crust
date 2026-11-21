/**
 * `type`, `key` and `hover` against the fake page: the three commands that send input into a page.
 * `type` carries the one rule worth a dedicated control below — a plain `element.value = …` is
 * invisible to a framework's value tracker, and the prototype setter is what makes it visible.
 */

import { describe, expect, test } from "bun:test";

import { createTestingPlugin } from "./testing";
import { FakeEvent, trackFrameworkValue } from "./testing-fake";
import { testPage } from "./testing-fixture";

describe("type", () => {
	test("sets the value through the prototype setter, so the framework sees the change", async () => {
		const fake = testPage();
		const changes: string[] = [];
		trackFrameworkValue(fake.field, changes);
		const answer = await createTestingPlugin(fake.adapter).commands.type({
			selector: "#name",
			text: "ada",
		});
		expect(answer).toEqual({ ok: true, value: "ada", fake: true });
		expect(fake.field.value).toBe("ada");
		expect(fake.field.focused).toBe(true);
		// The trap: this is the answer a plain `element.value = …` could not produce.
		expect(changes).toEqual(["ada"]);
	});

	test("the control: a plain assignment plus an input event is invisible to the tracker", async () => {
		const fake = testPage();
		const changes: string[] = [];
		trackFrameworkValue(fake.field, changes);
		fake.field.value = "typed";
		fake.field.dispatchEvent(new FakeEvent("input", { bubbles: true }));
		expect(fake.field.value).toBe("typed");
		expect(changes).toEqual([]);
	});

	test("a non-field answers `handler-error`, never a silent value", async () => {
		const fake = testPage();
		const answer = await createTestingPlugin(fake.adapter).commands.type({
			selector: "#box",
			text: "x",
		});
		expect("code" in answer && answer.code).toBe("handler-error");
		expect("message" in answer && answer.message).toContain("holds no value");
		expect(fake.box.focused).toBe(false);
	});
});

describe("key", () => {
	test("sends keydown and keyup to the focused element with its modifiers", async () => {
		const fake = testPage();
		const seen: string[] = [];
		fake.field.addEventListener("keydown", (event) => seen.push(`down:${event.key}`));
		fake.field.addEventListener("keyup", (event) => seen.push(`up:${event.key}`));
		fake.field.focus();
		const answer = await createTestingPlugin(fake.adapter).commands.key({
			key: "Enter",
			modifiers: { shift: true },
		});
		expect(seen).toEqual(["down:Enter", "up:Enter"]);
		expect(answer).toEqual({
			ok: true,
			key: "Enter",
			modifiers: { alt: false, ctrl: false, meta: false, shift: true },
			target: "INPUT",
			fake: true,
		});
	});
});

describe("hover", () => {
	test("dispatches mouseover and mousemove on the element", async () => {
		const fake = testPage();
		const seen: string[] = [];
		fake.button.addEventListener("mouseover", () => seen.push("over"));
		fake.button.addEventListener("mousemove", () => seen.push("move"));
		const answer = await createTestingPlugin(fake.adapter).commands.hover({ selector: "#go" });
		expect(answer).toEqual({ ok: true, hovered: true, fake: true });
		expect(seen).toEqual(["over", "move"]);
	});
});
