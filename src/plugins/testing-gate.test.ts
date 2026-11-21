/**
 * The `testing` gate, both halves, through the real registry. `CRUST_TEST=1` puts the namespace in
 * the core set and `click` reaches a page; without it the name is absent, so the bridge answers
 * `unknown-plugin` before any handler is asked — the same refusal a misspelt namespace gets.
 */

import { afterEach, describe, expect, test } from "bun:test";

import { corePluginsFor, testingEnabled } from "./core";
import { PluginRegistry } from "./registry";
import { setTestingAdapter } from "./testing";
import { FakeDocument, FakeElement, fakeAdapter } from "./testing-fake";

const ctx = { emit: () => {} };

afterEach(() => {
	setTestingAdapter(undefined);
});

function registryFor(env: { CRUST_TEST?: string }) {
	return new PluginRegistry().register(...corePluginsFor(env));
}

describe("the CRUST_TEST gate", () => {
	test("reads one exact value, so a half-set variable is not a test run", () => {
		expect(testingEnabled({ CRUST_TEST: "1" })).toBe(true);
		expect(testingEnabled({ CRUST_TEST: "0" })).toBe(false);
		expect(testingEnabled({ CRUST_TEST: "true" })).toBe(false);
		expect(testingEnabled({})).toBe(false);
	});

	test("with the flag set the namespace is registered and click reaches the page", async () => {
		const fake = fakeAdapter(new FakeDocument());
		const button = new FakeElement("button", { id: "go" });
		fake.document.body.append(button);
		setTestingAdapter(fake.adapter);
		const registry = registryFor({ CRUST_TEST: "1" });
		expect(registry.has("testing")).toBe(true);
		const answer = await registry.invoke("testing", "click", { selector: "#go" }, ctx);
		expect(answer).toEqual({ ok: true, clicked: true, verified: true, fake: true });
		expect(button.clicks).toBe(1);
	});

	test("without the flag the namespace is absent and the invoke is `unknown-plugin`", async () => {
		const registry = registryFor({});
		expect(registry.has("testing")).toBe(false);
		expect(registry.names()).not.toContain("testing");
		const refused = registry.invoke("testing", "click", { selector: "#go" }, ctx);
		await expect(refused).rejects.toMatchObject({
			code: "unknown-plugin",
			message: 'no plugin named "testing"',
		});
	});
});
