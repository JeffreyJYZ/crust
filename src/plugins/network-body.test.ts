/**
 * `crust:network`'s bytes: what an `allow` rule serves, what the log records about it, and the two
 * bounds that keep a served response inside the native buffers. No WebKit here either — the fake
 * adapter asks the handler the way `-startURLSchemeTask:` does.
 */

import { describe, expect, test } from "bun:test";

import { fakeNetwork, ok, recorder } from "@/plugins/network-fake.ts";
import {
	createNetworkPlugin,
	NETWORK_BODY_LIMIT,
	NETWORK_DEFAULT_TYPE,
	NETWORK_URL_LIMIT,
} from "@/plugins/network.ts";

describe("network served bytes", () => {
	test("an allow rule carries its body and type, and a bare allow answers an empty 200", async () => {
		const { adapter, decide } = fakeNetwork();
		const plugin = createNetworkPlugin(adapter);
		ok(
			await plugin.commands.setRules(
				{
					rules: [
						{
							pattern: "crust-net://fixture/*",
							action: "allow",
							body: "served-bytes-42",
							type: "text/plain",
						},
						{ pattern: "crust-net://plain/*", action: "allow" },
						{ pattern: "crust-net://*", action: "block" },
					],
				},
				recorder().ctx,
			),
		);
		expect(decide("crust-net://fixture/a")).toEqual({
			action: "allow",
			body: "served-bytes-42",
			type: "text/plain",
		});
		// A rule with no body is an empty 200 with the default type, never a fetch.
		expect(decide("crust-net://plain/b")).toEqual({
			action: "allow",
			body: "",
			type: NETWORK_DEFAULT_TYPE,
		});
		expect(decide("crust-net://other/c")).toEqual({ action: "block" });
	});

	test("each intercepted request is logged and emitted with its status and size", async () => {
		const { adapter, decide } = fakeNetwork();
		const { events, ctx } = recorder();
		const plugin = createNetworkPlugin(adapter);
		ok(
			await plugin.commands.setRules(
				{
					rules: [
						{ pattern: "https://ads.example/*", action: "block" },
						{ pattern: "https://crust.dev/*", action: "allow", body: "four" },
					],
				},
				ctx,
			),
		);

		expect(decide("https://ads.example/x")?.action).toBe("block");
		expect(decide("https://crust.dev/y")?.action).toBe("allow");
		expect(events).toEqual([
			{
				event: "network:request",
				data: { url: "https://ads.example/x", action: "block", status: "blocked" },
			},
			{
				event: "network:request",
				data: { url: "https://crust.dev/y", action: "allow", status: "served", bytes: 4 },
			},
		]);
		expect(ok(await plugin.commands.log({}, ctx)).entries).toEqual([
			{ url: "https://ads.example/x", action: "block", status: "blocked" },
			{ url: "https://crust.dev/y", action: "allow", status: "served", bytes: 4 },
		]);
	});

	test("a body at or over the native buffer, or on a block rule, is refused by name", async () => {
		const { adapter } = fakeNetwork();
		const { ctx } = recorder();
		const plugin = createNetworkPlugin(adapter);
		// The C side delivers NETWORK_BODY_LIMIT - 1 bytes (one is the terminator), so a body
		// of exactly NETWORK_BODY_LIMIT loses its last byte. Refuse it, not only a bigger one.
		for (const tooBig of ["x".repeat(NETWORK_BODY_LIMIT), "x".repeat(NETWORK_BODY_LIMIT + 1)]) {
			await expect(
				plugin.commands.setRules(
					{ rules: [{ pattern: "*", action: "allow", body: tooBig }] },
					ctx,
				),
			).rejects.toMatchObject({ code: "bad-request" });
		}
		for (const rules of [
			[{ pattern: "*", action: "allow", type: "x".repeat(200) }],
			[{ pattern: "*", action: "block", body: "x" }],
			[{ pattern: "*", action: "allow", body: 42 }],
		]) {
			await expect(plugin.commands.setRules({ rules }, ctx)).rejects.toMatchObject({
				code: "bad-request",
			});
		}
	});

	test("the largest body the native buffer can deliver is accepted whole", async () => {
		const { adapter, decide } = fakeNetwork();
		const { ctx } = recorder();
		const plugin = createNetworkPlugin(adapter);
		const largest = "x".repeat(NETWORK_BODY_LIMIT - 1);
		ok(
			await plugin.commands.setRules(
				{ rules: [{ pattern: "*", action: "allow", body: largest }] },
				ctx,
			),
		);
		expect(decide("crust-net://app/a")?.body).toBe(largest);
		expect(ok(await plugin.commands.log({}, ctx)).entries[0]?.bytes).toBe(largest.length);
	});

	test("a URL at the native buffer bound is blocked, never matched as a prefix", async () => {
		const { adapter, decide } = fakeNetwork();
		const { ctx } = recorder();
		const plugin = createNetworkPlugin(adapter);
		ok(await plugin.commands.setRules({ rules: [{ pattern: "*", action: "allow" }] }, ctx));
		const prefix = "crust-net://app/";
		const exact = `${prefix}${"a".repeat(NETWORK_URL_LIMIT - prefix.length)}`;
		expect(Buffer.byteLength(exact, "utf8")).toBe(NETWORK_URL_LIMIT);
		expect(decide(exact)).toEqual({ action: "block" });
		expect(decide(`${prefix}${"a".repeat(10)}`)?.action).toBe("allow");
		const entry = ok(await plugin.commands.log({}, ctx)).entries[0];
		expect(entry?.status).toBe("blocked");
		expect(entry?.reason?.startsWith("url-too-long")).toBe(true);
	});
});
