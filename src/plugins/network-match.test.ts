/**
 * The two ways the rule matcher could be dodged, proven on their own: a `block` rule keyed on one case of
 * a URL, and a URL long enough that the native handler hands the matcher a truncated prefix.
 */

import { describe, expect, test } from "bun:test";

import {
	createNetworkPlugin,
	foldsCase,
	NETWORK_SCHEME,
	NETWORK_URL_LIMIT,
	type NetworkAction,
	type NetworkAdapter,
	type NetworkInstall,
	patternMatches,
} from "@/plugins/network.ts";

/** An adapter that keeps the handler, so a test can ask it what WebKit would. */
function fakeNetwork(): { adapter: NetworkAdapter; decide: (url: string) => NetworkAction } {
	let decide: ((url: string) => NetworkAction) | undefined;
	const adapter: NetworkAdapter = {
		install(scheme: string, handler: (url: string) => NetworkAction): NetworkInstall {
			expect(scheme).toBe(NETWORK_SCHEME);
			decide = handler;
			return { ok: true, reason: "registered" };
		},
	};
	return {
		adapter,
		decide: (url) => {
			if (decide === undefined) throw new Error("the handler was never installed");
			return decide(url);
		},
	};
}

const ctx = { emit: () => undefined };

describe("network case folding", () => {
	test("a platform whose paths are case-insensitive folds, and linux does not", () => {
		expect(foldsCase("darwin")).toBe(true);
		expect(foldsCase("win32")).toBe(true);
		expect(foldsCase("linux")).toBe(false);
	});

	test("/ETC/HOSTS matches a /etc/hosts rule on darwin and not on linux", () => {
		expect(patternMatches("/etc/hosts", "/ETC/HOSTS", { caseInsensitive: true })).toBe(true);
		expect(patternMatches("/etc/hosts", "/ETC/HOSTS", { caseInsensitive: false })).toBe(false);
		expect(patternMatches("/etc/hosts", "/etc/hosts", { caseInsensitive: false })).toBe(true);
	});

	test("an upper-cased host cannot slip a block rule through the plugin", async () => {
		const { adapter, decide } = fakeNetwork();
		const plugin = createNetworkPlugin(adapter, { caseInsensitive: true });
		await plugin.commands.setRules(
			{ rules: [{ pattern: "crust-net://app/etc/hosts", action: "block" }] },
			ctx,
		);
		expect(decide("crust-net://app/ETC/HOSTS")).toBe("block");
		expect(decide("crust-net://APP/Etc/Hosts")).toBe("block");
		expect(decide("crust-net://app/other")).toBe("allow");

		const strict = fakeNetwork();
		const exact = createNetworkPlugin(strict.adapter, { caseInsensitive: false });
		await exact.commands.setRules(
			{ rules: [{ pattern: "crust-net://app/etc/hosts", action: "block" }] },
			ctx,
		);
		expect(strict.decide("crust-net://app/etc/hosts")).toBe("block");
		expect(strict.decide("crust-net://app/ETC/HOSTS")).toBe("allow");
	});
});

describe("network long URLs", () => {
	test("a 4 KB URL cannot slip a tail-anchored rule: it is blocked, never matched as a prefix", async () => {
		const { adapter, decide } = fakeNetwork();
		const plugin = createNetworkPlugin(adapter);
		await plugin.commands.setRules({ rules: [{ pattern: "*.png", action: "block" }] }, ctx);
		expect(decide("crust-net://app/short.png")).toBe("block");
		expect(decide("crust-net://app/short.txt")).toBe("allow");

		const padded = `crust-net://app/${"a".repeat(4096)}.png`;
		expect(padded.length).toBeGreaterThan(NETWORK_URL_LIMIT);
		expect(decide(padded)).toBe("block");
		const logged = await plugin.commands.log({}, ctx);
		if (!("entries" in logged)) throw new Error("no adapter");
		expect(logged.entries.at(-1)?.reason).toContain("url-too-long");
	});

	test("a URL right at the native buffer's bound is refused rather than matched", async () => {
		const { adapter, decide } = fakeNetwork();
		const plugin = createNetworkPlugin(adapter);
		await plugin.commands.setRules({ rules: [{ pattern: "*", action: "allow" }] }, ctx);
		const prefix = "crust-net://app/";
		const exact = `${prefix}${"a".repeat(NETWORK_URL_LIMIT - prefix.length)}`;
		expect(Buffer.byteLength(exact, "utf8")).toBe(NETWORK_URL_LIMIT);
		expect(decide(exact)).toBe("block");
		expect(decide(`${prefix}${"a".repeat(10)}`)).toBe("allow");
	});

	test("a pattern too long or with too many stars is bad-request, not a slow match", async () => {
		const { adapter } = fakeNetwork();
		const plugin = createNetworkPlugin(adapter);
		for (const pattern of ["a".repeat(2049), `${"*a".repeat(40)}*`]) {
			await expect(
				plugin.commands.setRules({ rules: [{ pattern, action: "block" }] }, ctx),
			).rejects.toMatchObject({ code: "bad-request" });
		}
	});
});
