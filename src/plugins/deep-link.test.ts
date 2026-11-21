/**
 * `crust:deep-link` proofs. Nothing here asks macOS to open a URL — that needs a registered bundle and a human — so they stop at the state the runtime feeds and at the event a page receives, and the report says so rather than implying a real launch was observed.
 */

import { describe, expect, test } from "bun:test";
import { isNotImplemented, type PluginContext } from "./define.ts";
import { createDeepLink, deepLink, parseDeepLink } from "./deep-link.ts";

/** A context that records what a page would receive. */
function recorder(): { ctx: PluginContext; events: Array<[string, unknown]> } {
	const events: Array<[string, unknown]> = [];
	return { ctx: { emit: (event, data) => events.push([event, data]) }, events };
}

describe("parseDeepLink", () => {
	test("splits a hierarchical custom-scheme URL", () => {
		expect(parseDeepLink("crust://open/notes/42?x=1&y=two")).toEqual({
			scheme: "crust",
			host: "open",
			path: "/notes/42",
			query: { x: "1", y: "two" },
		});
	});

	test("an opaque form has no host and keeps its path", () => {
		expect(parseDeepLink("crust:open?x=1")).toEqual({
			scheme: "crust",
			host: "",
			path: "open",
			query: { x: "1" },
		});
	});

	test("no query is an empty record, not a missing one", () => {
		expect(parseDeepLink("crust://open").query).toEqual({});
	});

	test("the scheme is lowercased, because a protocol is case-insensitive", () => {
		expect(parseDeepLink("CRUST://open").scheme).toBe("crust");
	});

	test("a repeated key keeps the last value, which is what a page reads", () => {
		expect(parseDeepLink("crust://open?a=1&a=2").query).toEqual({ a: "2" });
	});

	test("refuses a relative string and a non-string", () => {
		expect(() => parseDeepLink("not a url")).toThrow(TypeError);
		expect(() => parseDeepLink("")).toThrow(/non-empty string/);
		expect(() => parseDeepLink(undefined)).toThrow(/non-empty string/);
	});
});

describe("deep-link plugin", () => {
	test("without a scheme every answer is honest, never a fake route", () => {
		const link = createDeepLink();
		expect(link.scheme).toBeUndefined();
		expect(link.url()).toBeNull();

		const answer = link.plugin.commands.scheme();
		expect(isNotImplemented(answer)).toBe(true);
		if (isNotImplemented(answer)) expect(answer.requires).toBe("CFBundleURLTypes");
		expect(link.plugin.commands.url()).toBeNull();
	});

	test("a configured scheme is the one the plugin reports", () => {
		const link = createDeepLink({ scheme: "crust" });
		expect(link.plugin.commands.scheme()).toBe("crust");
		expect(link.plugin.name).toBe("deep-link");
	});

	test("an invalid scheme is refused when the plugin is created, not at launch", () => {
		expect(() => createDeepLink({ scheme: "http" })).toThrow(/reserved/);
		expect(() => createDeepLink({ scheme: "Crust" })).toThrow(/deep-link scheme/);
	});

	test("launch records the opening URL and pushes it to pages", () => {
		const link = createDeepLink({ scheme: "crust" });
		const { ctx, events } = recorder();
		const target = link.launch("crust://open/42", ctx);

		expect(target).toEqual({ scheme: "crust", host: "open", path: "/42", query: {} });
		expect(link.url()).toBe("crust://open/42");
		expect(events).toEqual([["deep-link", { url: "crust://open/42" }]]);
	});

	test("a launch with no URL is no link and emits nothing", () => {
		const link = createDeepLink({ scheme: "crust" });
		const { ctx, events } = recorder();
		expect(link.launch(undefined, ctx)).toBeNull();
		expect(link.launch("", ctx)).toBeNull();
		expect(link.url()).toBeNull();
		expect(events).toEqual([]);
	});

	test("a second open replaces the first, and both are emitted in order", () => {
		const link = createDeepLink({ scheme: "crust" });
		const { ctx, events } = recorder();
		link.open("crust://open/first", ctx);
		link.open("crust://open/second", ctx);

		expect(link.url()).toBe("crust://open/second");
		expect(link.plugin.commands.url()).toBe("crust://open/second");
		expect(events).toEqual([
			["deep-link", { url: "crust://open/first" }],
			["deep-link", { url: "crust://open/second" }],
		]);
	});

	test("a URL for another scheme is refused and leaves the held URL alone", () => {
		const link = createDeepLink({ scheme: "crust" });
		const { ctx, events } = recorder();
		link.open("crust://open/kept", ctx);

		expect(() => link.open("other://open/stolen", ctx)).toThrow(/not the registered scheme/);
		expect(link.url()).toBe("crust://open/kept");
		expect(events.length).toBe(1);
	});

	test("with no scheme configured, any absolute URL is accepted", () => {
		const link = createDeepLink();
		expect(link.open("crust://open/42").scheme).toBe("crust");
		expect(link.url()).toBe("crust://open/42");
	});

	test("the default registration holds no URL until the runtime supplies one", () => {
		expect(deepLink.plugin.name).toBe("deep-link");
		expect(deepLink.scheme).toBeUndefined();
		expect(deepLink.url()).toBeNull();
	});
});

describe("deep-link runtime wiring", () => {
	test("a singleton with no scheme says what the runtime must do", () => {
		const link = createDeepLink();
		const answer = link.plugin.commands.scheme();
		expect(isNotImplemented(answer)).toBe(true);
		if (isNotImplemented(answer)) {
			expect(answer.requires).toBe("CFBundleURLTypes");
			expect(answer.message).toContain("deepLink.configure");
		}
	});

	test("configure supplies the scheme the singleton then reports and guards with", () => {
		const link = createDeepLink();
		link.configure("crust");
		expect(link.scheme).toBe("crust");
		expect(link.plugin.commands.scheme()).toBe("crust");
		expect(() => link.open("other://open/1")).toThrow(/not the registered scheme/);
		link.configure(undefined);
		expect(link.scheme).toBeUndefined();
	});

	test("an attached sink hears later links with no per-call context", () => {
		const link = createDeepLink({ scheme: "crust" });
		const { ctx, events } = recorder();
		const detach = link.attach(ctx.emit);
		link.open("crust://open/later");
		expect(events).toEqual([["deep-link", { url: "crust://open/later" }]]);
		detach();
		link.open("crust://open/after-detach");
		expect(events).toHaveLength(1);
	});

	test("an attached sink and a per-call context each hear the link once", () => {
		const link = createDeepLink({ scheme: "crust" });
		const a = recorder();
		const b = recorder();
		link.attach(a.ctx.emit);
		link.open("crust://open/both", b.ctx);
		expect(a.events).toEqual([["deep-link", { url: "crust://open/both" }]]);
		expect(b.events).toEqual([["deep-link", { url: "crust://open/both" }]]);
	});
});
