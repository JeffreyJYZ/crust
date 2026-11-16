/**
 * The fail-closed URL bound, proven through the path a request really takes rather than by calling
 * `decide` with a string the handler could never produce.
 * The chain is: `net_copy` keeps at most `NET_TEXT - 1` bytes of the URL, the darwin adapter reads
 * those bytes into `URL_CHUNK`, and `decide` matches what it got. Two links used to disagree — a
 * 1024-byte read buffer under a 2047-byte bound — so every URL reached the matcher as a 1023-byte
 * prefix and the bound could never fire. Both halves are asserted here.
 */

import { describe, expect, test } from "bun:test";

import { URL_CHUNK } from "@/platform/darwin/network";
import { fakeNetwork, ok, recorder } from "@/plugins/network-fake.ts";
import { createNetworkPlugin, NETWORK_URL_LIMIT } from "@/plugins/network.ts";

/**
 * What `net_copy` does to a URL before `decide` sees it: the whole string when it fits
 * `net_text[2048]`, otherwise the first 2047 bytes. Modelling it is the point — a test that hands
 * `decide` a 4 KB string exercises a length the native side never produces.
 */
function nativeCopy(url: string): string {
	const bytes = Buffer.from(url, "utf8");
	if (bytes.length <= NETWORK_URL_LIMIT) return url;
	return bytes.subarray(0, NETWORK_URL_LIMIT).toString("utf8");
}

const PREFIX = "crust-net://app/";

describe("network URL bound", () => {
	test("the read buffer covers the whole native buffer", () => {
		// The defect this replaces: 1024 read under a 2047 bound, so the check was unreachable.
		expect(URL_CHUNK).toBeGreaterThan(NETWORK_URL_LIMIT);
	});

	test("a 4 KB URL cannot slip a tail-anchored rule: it is refused, never matched on its prefix", async () => {
		const { adapter, decide } = fakeNetwork();
		const { ctx } = recorder();
		const plugin = createNetworkPlugin(adapter);
		ok(await plugin.commands.setRules({ rules: [{ pattern: "*.png", action: "block" }] }, ctx));

		// The dodge: the real URL ends `.png`, the prefix the handler keeps does not.
		const padded = `${PREFIX}${"a".repeat(4096)}.png`;
		expect(Buffer.byteLength(padded)).toBeGreaterThan(NETWORK_URL_LIMIT);
		const kept = nativeCopy(padded);
		expect(kept.endsWith(".png")).toBe(false);

		expect(decide(kept)).toEqual({ action: "block" });
		const entry = ok(await plugin.commands.log({}, ctx)).entries.at(-1);
		expect(entry?.status).toBe("blocked");
		expect(entry?.reason).toContain("url-too-long");
	});

	test("a URL just under the bound still matches its rules normally", async () => {
		const { adapter, decide } = fakeNetwork();
		const { ctx } = recorder();
		const plugin = createNetworkPlugin(adapter);
		ok(await plugin.commands.setRules({ rules: [{ pattern: "*.png", action: "block" }] }, ctx));

		// 2046 bytes: one under the bound, so it is stored whole and matched as written.
		const under = `${PREFIX}${"a".repeat(NETWORK_URL_LIMIT - 1 - PREFIX.length - 4)}.png`;
		expect(Buffer.byteLength(under)).toBe(NETWORK_URL_LIMIT - 1);
		expect(nativeCopy(under)).toBe(under);
		expect(decide(under)).toEqual({ action: "block" });

		const other = under.replace(/\.png$/, ".txt");
		expect(decide(other)?.action).toBe("allow");
		expect(ok(await plugin.commands.log({}, ctx)).entries.at(-1)?.reason).toBeUndefined();
	});

	test("a URL at the bound is refused rather than matched, so no prefix is ever trusted", async () => {
		const { adapter, decide } = fakeNetwork();
		const { ctx } = recorder();
		const plugin = createNetworkPlugin(adapter);
		ok(await plugin.commands.setRules({ rules: [{ pattern: "*", action: "allow" }] }, ctx));
		const exact = `${PREFIX}${"a".repeat(NETWORK_URL_LIMIT - PREFIX.length)}`;
		expect(Buffer.byteLength(exact)).toBe(NETWORK_URL_LIMIT);
		expect(decide(nativeCopy(exact))).toEqual({ action: "block" });
		const entry = ok(await plugin.commands.log({}, ctx)).entries.at(-1);
		expect(entry?.reason?.startsWith("url-too-long")).toBe(true);
	});
});
