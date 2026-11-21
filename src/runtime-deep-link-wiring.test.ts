/**
 * The runtime half of deep links, proven without macOS: the scheme guard is fed by config, the
 * app-wide sink reaches an armed page, and a link that lands before the first page is replayed
 * when one arms. The native delegate is not driven here — its own unit has its own tests. Each case
 * uses its own `DeepLink`, so no state leaks into the singleton another suite asserts on.
 */

import { afterEach, describe, expect, test } from "bun:test";
import type { CrustConfig } from "@/config";
import { createDeepLink, isNotImplemented, type DeepLink, type PluginContext } from "@/plugins";
import {
	armDeepLinkPage,
	attachDeepLinkDelivery,
	configureDeepLink,
	queueDeepLink,
} from "./app-deep-link.ts";

const base: CrustConfig = {
	app: { id: "land.jyz.deep-link-wiring", name: "wiring", version: "0.0.0" },
	windows: [{ label: "main", url: "/" }],
};

let link: DeepLink;
let disarms: Array<() => void>;
let detach: () => void;

afterEach(() => {
	for (const off of disarms) off();
	detach?.();
	disarms = [];
});

function fresh(): DeepLink {
	link = createDeepLink();
	disarms = [];
	detach = attachDeepLinkDelivery(link);
	return link;
}

function recorder(): { emit: PluginContext["emit"]; events: Array<[string, unknown]> } {
	const events: Array<[string, unknown]> = [];
	return { emit: (event, data) => events.push([event, data]), events };
}

function page(events: Array<[string, unknown]>): void {
	disarms.push(armDeepLinkPage((event, data) => events.push([event, data])));
}

describe("deep-link scheme wiring", () => {
	test("a configured scheme is the one the mounted plugin answers", () => {
		const configured = fresh();
		configureDeepLink({ ...base, build: { urlScheme: "crust" } }, configured);
		expect(configured.scheme).toBe("crust");
		expect(configured.plugin.commands.scheme()).toBe("crust");
	});

	test("with no build.urlScheme the scheme command still refuses by name", () => {
		const configured = fresh();
		configureDeepLink(base, configured);
		const answer = configured.plugin.commands.scheme();
		expect(isNotImplemented(answer)).toBe(true);
		if (isNotImplemented(answer)) {
			expect(answer.requires).toBe("CFBundleURLTypes");
			expect(answer.message).toContain("deepLink.configure");
		}
	});

	test("the guard also rejects a URL for a scheme that was never registered", () => {
		const configured = fresh();
		configureDeepLink({ ...base, build: { urlScheme: "crust" } }, configured);
		expect(() => queueDeepLink("other://open/1", configured)).toThrow(
			/not the registered scheme/,
		);
	});
});

describe("deep-link page delivery", () => {
	test("a link that arrives before the first page is delivered when one arms", () => {
		const configured = fresh();
		configureDeepLink({ ...base, build: { urlScheme: "crust" } }, configured);
		queueDeepLink("crust://open/early", configured);

		const seen: Array<[string, unknown]> = [];
		page(seen);
		expect(seen).toEqual([["deep-link", { url: "crust://open/early" }]]);
		expect(configured.url()).toBe("crust://open/early");
	});

	test("a later link reaches an armed page through the attached sink exactly once", () => {
		const configured = fresh();
		configureDeepLink({ ...base, build: { urlScheme: "crust" } }, configured);
		const seen: Array<[string, unknown]> = [];
		page(seen);

		queueDeepLink("crust://open/later", configured);
		expect(seen).toEqual([["deep-link", { url: "crust://open/later" }]]);
	});

	test("two pages each hear the link once, and a detached page stops hearing it", () => {
		const configured = fresh();
		configureDeepLink({ ...base, build: { urlScheme: "crust" } }, configured);
		const a = recorder();
		const b = recorder();
		disarms.push(armDeepLinkPage(a.emit));
		disarms.push(armDeepLinkPage(b.emit));

		queueDeepLink("crust://open/both", configured);
		expect(a.events).toEqual([["deep-link", { url: "crust://open/both" }]]);
		expect(b.events).toEqual([["deep-link", { url: "crust://open/both" }]]);

		disarms.shift()?.();
		queueDeepLink("crust://open/again", configured);
		expect(a.events).toHaveLength(1);
		expect(b.events).toHaveLength(2);
	});
});
