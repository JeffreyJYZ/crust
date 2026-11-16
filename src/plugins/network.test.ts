/**
 * `crust:network` proofs that need no WebKit: the registration, the rule table and the log. Every
 * test injects the fake adapter, so nothing here registers a scheme handler.
 * The bytes a rule carries are `network-body.test.ts`; this file is the contract around them.
 */

import { describe, expect, test } from "bun:test";

import { fakeNetwork, ok, recorder } from "@/plugins/network-fake.ts";
import { isNotImplemented } from "@/plugins/define.ts";
import {
	createNetworkPlugin,
	NETWORK_LOG_LIMIT,
	NETWORK_SCHEME,
	networkPlugin,
} from "@/plugins/network.ts";

describe("network plugin", () => {
	test("not-implemented without an adapter, naming WKURLSchemeHandler", async () => {
		const plugin = createNetworkPlugin();
		for (const result of [
			await plugin.commands.rules({}, recorder().ctx),
			await plugin.commands.setRules({ rules: [] }, recorder().ctx),
			await plugin.commands.log({}, recorder().ctx),
			await plugin.commands.clearLog({}, recorder().ctx),
		]) {
			expect(isNotImplemented(result)).toBe(true);
			if (isNotImplemented(result)) expect(result.requires).toBe("WKURLSchemeHandler");
		}
	});

	test("the default registration is the adapter-less one", () => {
		expect(networkPlugin.name).toBe("network");
		expect(typeof networkPlugin.commands.rules).toBe("function");
	});

	test("rules() registers the handler once and reports the scheme", async () => {
		const { adapter, schemes } = fakeNetwork();
		const plugin = createNetworkPlugin(adapter);
		const first = ok(await plugin.commands.rules({}, recorder().ctx));
		const second = ok(await plugin.commands.rules({}, recorder().ctx));
		expect(first).toEqual({
			ok: true,
			scheme: NETWORK_SCHEME,
			rules: [],
			registered: true,
			reason: "registered",
		});
		expect(second).toEqual(first);
		expect(schemes).toEqual([NETWORK_SCHEME]);
	});

	test("a refused registration is reported, not hidden", async () => {
		const { adapter } = fakeNetwork({ ok: false, reason: "no configuration" });
		const plugin = createNetworkPlugin(adapter);
		const result = ok(await plugin.commands.rules({}, recorder().ctx));
		expect(result.registered).toBe(false);
		expect(result.reason).toBe("no configuration");
	});

	test("setRules stores the rules and a bad rule is bad-request", async () => {
		const { adapter } = fakeNetwork();
		const { ctx } = recorder();
		const plugin = createNetworkPlugin(adapter);
		const rules = [
			{ pattern: "https://ads.example/*", action: "block" as const },
			{ pattern: "*", action: "allow" as const, body: "hello" },
		];
		expect(ok(await plugin.commands.setRules({ rules }, ctx)).rules).toEqual(rules);
		expect(ok(await plugin.commands.rules({}, ctx)).rules).toEqual(rules);

		await expect(plugin.commands.setRules({ rules: "nope" }, ctx)).rejects.toMatchObject({
			code: "bad-request",
		});
		await expect(
			plugin.commands.setRules({ rules: [{ pattern: "", action: "block" }] }, ctx),
		).rejects.toMatchObject({ code: "bad-request" });
		await expect(
			plugin.commands.setRules({ rules: [{ pattern: "*", action: "deny" }] }, ctx),
		).rejects.toMatchObject({ code: "bad-request" });
		// A refused rule set leaves the stored one alone.
		expect(ok(await plugin.commands.rules({}, ctx)).rules).toEqual(rules);
	});

	test("a pattern too long or with too many stars is bad-request, not a slow match", async () => {
		const { adapter } = fakeNetwork();
		const plugin = createNetworkPlugin(adapter);
		for (const pattern of ["a".repeat(2049), `${"*a".repeat(40)}*`]) {
			await expect(
				plugin.commands.setRules({ rules: [{ pattern, action: "block" }] }, recorder().ctx),
			).rejects.toMatchObject({ code: "bad-request" });
		}
	});

	test("the first match wins, and no match allows", async () => {
		const { adapter, decide } = fakeNetwork();
		const plugin = createNetworkPlugin(adapter);
		ok(
			await plugin.commands.setRules(
				{
					rules: [
						{ pattern: "crust-net://allowed/*", action: "allow" },
						{ pattern: "crust-net://*", action: "block" },
					],
				},
				recorder().ctx,
			),
		);
		expect(decide("crust-net://allowed/a")?.action).toBe("allow");
		expect(decide("crust-net://other/b")?.action).toBe("block");
	});

	test("case folding follows the platform, so a block rule cannot be dodged by case", async () => {
		const { adapter, decide } = fakeNetwork();
		const plugin = createNetworkPlugin(adapter, { caseInsensitive: true });
		ok(
			await plugin.commands.setRules(
				{ rules: [{ pattern: "crust-net://app/etc/hosts", action: "block" }] },
				recorder().ctx,
			),
		);
		expect(decide("crust-net://app/ETC/HOSTS")?.action).toBe("block");
		expect(decide("crust-net://APP/Etc/Hosts")?.action).toBe("block");
		expect(decide("crust-net://app/other")?.action).toBe("allow");
	});

	test("the log keeps the last NETWORK_LOG_LIMIT entries and clearLog empties it", async () => {
		const { adapter, decide } = fakeNetwork();
		const { ctx } = recorder();
		const plugin = createNetworkPlugin(adapter);
		ok(await plugin.commands.rules({}, ctx));
		for (let index = 0; index < NETWORK_LOG_LIMIT + 5; index++) {
			decide(`https://crust.dev/${index}`);
		}
		const entries = ok(await plugin.commands.log({}, ctx)).entries;
		expect(entries).toHaveLength(NETWORK_LOG_LIMIT);
		expect(entries[0]?.url).toBe("https://crust.dev/5");
		expect(entries.at(-1)?.url).toBe(`https://crust.dev/${NETWORK_LOG_LIMIT + 4}`);

		expect(ok(await plugin.commands.clearLog({}, ctx))).toEqual({
			ok: true,
			cleared: NETWORK_LOG_LIMIT,
		});
		expect(ok(await plugin.commands.log({}, ctx)).entries).toEqual([]);
	});
});
