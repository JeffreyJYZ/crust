/**
 * `crust:network` proofs that need no WebKit. Every test injects a fake adapter, so nothing here
 * registers a scheme handler or fetches a URL.
 * What is proven is the contract: a rule set is validated before it is stored, the first match wins,
 * every intercepted request is logged and emitted, and the log stays bounded.
 */

import { describe, expect, test } from "bun:test";

import { isNotImplemented, type NotImplemented } from "@/plugins/define.ts";
import {
	createNetworkPlugin,
	NETWORK_LOG_LIMIT,
	NETWORK_SCHEME,
	type NetworkAction,
	type NetworkAdapter,
	type NetworkInstall,
	networkPlugin,
} from "@/plugins/network.ts";

/** A result the test knows landed: a `NotImplemented` becomes a failure with its own message. */
function ok<T>(value: T | NotImplemented): T {
	if (isNotImplemented(value)) throw new Error(`not-implemented: ${value.message}`);
	return value;
}

interface FakeNetwork {
	adapter: NetworkAdapter;
	/** The scheme each install was asked for. */
	schemes: string[];
	/** Ask the rule set the way WebKit's handler does. */
	decide: (url: string) => NetworkAction | undefined;
}

function fakeNetwork(install: NetworkInstall = { ok: true, reason: "registered" }): FakeNetwork {
	const schemes: string[] = [];
	let decide: ((url: string) => NetworkAction) | undefined;
	const adapter: NetworkAdapter = {
		install(scheme, handler) {
			schemes.push(scheme);
			decide = handler;
			return install;
		},
	};
	return { adapter, schemes, decide: (url) => decide?.(url) };
}

interface Recorder {
	events: { event: string; data: unknown }[];
	ctx: { emit: (event: string, data: unknown) => void };
}

function recorder(): Recorder {
	const events: { event: string; data: unknown }[] = [];
	return { events, ctx: { emit: (event, data) => events.push({ event, data }) } };
}

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
			{ pattern: "*", action: "allow" as const },
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

	test("the first match wins and no match allows", async () => {
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
		expect(decide("crust-net://allowed/a")).toBe("allow");
		expect(decide("crust-net://other/b")).toBe("block");
	});

	test("each intercepted request is logged and emitted with its status", async () => {
		const { adapter, decide } = fakeNetwork();
		const { events, ctx } = recorder();
		const plugin = createNetworkPlugin(adapter);
		ok(
			await plugin.commands.setRules(
				{ rules: [{ pattern: "https://ads.example/*", action: "block" }] },
				ctx,
			),
		);

		expect(decide("https://ads.example/x")).toBe("block");
		expect(decide("https://crust.dev/y")).toBe("allow");
		expect(events).toEqual([
			{
				event: "network:request",
				data: { url: "https://ads.example/x", action: "block", status: "blocked" },
			},
			{
				event: "network:request",
				data: { url: "https://crust.dev/y", action: "allow", status: "served" },
			},
		]);
		expect(ok(await plugin.commands.log({}, ctx)).entries).toEqual([
			{ url: "https://ads.example/x", action: "block", status: "blocked" },
			{ url: "https://crust.dev/y", action: "allow", status: "served" },
		]);
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
