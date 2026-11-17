/**
 * `crust:navigation.loadUrl` — the one command that starts a fresh load rather than moving through history. The URL and label are validated before any native call, an adapter without a load path answers `not-implemented` naming `loadRequest:`, and a resolver refusal keeps its `bad-request`.
 */

import { describe, expect, test } from "bun:test";

import { collector, fakeNavigation } from "./navigation-fake.ts";
import { createNavigationPlugin, type NavigationAdapter } from "./navigation.ts";
import { isNotImplemented } from "./define";

const base = (): NavigationAdapter => ({
	start: () => ({ ok: true, status: 0, reason: "installed" }),
	stop: () => {},
	state: () => null,
	reload: () => true,
	goBack: () => true,
	goForward: () => true,
});

describe("navigation.loadUrl", () => {
	test("a valid URL reaches the adapter and answers whether a load started", () => {
		const fake = fakeNavigation({ load: true });
		const plugin = createNavigationPlugin(fake.adapter);
		expect(plugin.commands.loadUrl({ url: "https://crust.dev/docs" }, collector().ctx)).toEqual(
			{
				ok: true,
				loaded: true,
			},
		);
		expect(fake.calls).toEqual(["loadUrl:https://crust.dev/docs"]);
	});

	test("a missing or non-string URL is a bad-request before any native call", () => {
		const fake = fakeNavigation();
		const plugin = createNavigationPlugin(fake.adapter);
		expect(plugin.commands.loadUrl({} as { url: string }, collector().ctx)).toMatchObject({
			ok: false,
			code: "bad-request",
		});
		expect(plugin.commands.loadUrl({ url: "" }, collector().ctx)).toMatchObject({
			ok: false,
			code: "bad-request",
		});
		expect(
			plugin.commands.loadUrl({ url: 7 } as unknown as { url: string }, collector().ctx),
		).toMatchObject({
			ok: false,
			code: "bad-request",
		});
		expect(fake.calls).toEqual([]);
	});

	test("an adapter with no load path names loadRequest:", () => {
		const answer = createNavigationPlugin(base()).commands.loadUrl(
			{ url: "https://crust.dev" },
			collector().ctx,
		);
		expect(isNotImplemented(answer)).toBe(true);
		if (isNotImplemented(answer)) expect(answer.requires).toBe("loadRequest:");
	});

	test("no adapter at all names WKNavigationDelegate", () => {
		const answer = createNavigationPlugin().commands.loadUrl(
			{ url: "https://crust.dev" },
			collector().ctx,
		);
		expect(isNotImplemented(answer)).toBe(true);
		if (isNotImplemented(answer)) expect(answer.requires).toBe("WKNavigationDelegate");
	});

	test("a throwing adapter becomes a typed failure", () => {
		const adapter: NavigationAdapter = {
			...base(),
			loadUrl: () => {
				throw new Error("unit was not compiled");
			},
		};
		expect(
			createNavigationPlugin(adapter).commands.loadUrl(
				{ url: "https://crust.dev" },
				collector().ctx,
			),
		).toMatchObject({ ok: false, code: "handler-error", message: "unit was not compiled" });
	});
});
