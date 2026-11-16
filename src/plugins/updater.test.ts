import { describe, expect, test } from "bun:test";

import type { CheckArgs, CheckResult } from "@/plugins/updater";
import { offlineAdapter, plugin, signer } from "@/plugins/updater-fake";

async function check(manifest: unknown, currentVersion: string): Promise<CheckResult> {
	const adapter = offlineAdapter({ fetchJson: async () => manifest });
	return await plugin(adapter).check({
		endpoint: "https://example.test/latest.json",
		currentVersion,
	});
}

describe("updater.check", () => {
	test("0.10.0 is available over 0.9.0, and the manifest is passed through", async () => {
		const result = await check({ version: "0.10.0", notes: "faster", url: "u.app" }, "0.9.0");
		const expected = { available: true, version: "0.10.0", url: "u.app", notes: "faster" };
		expect(result).toEqual(expected);
	});

	test("the same or an older version is not available, and that is not an error", async () => {
		expect(await check({ version: "1.4.0", url: "u.app" }, "1.4.0")).toEqual({
			available: false,
			version: "1.4.0",
		});
		expect(await check({ version: "1.4.0", url: "u.app" }, "1.5.0")).toMatchObject({
			available: false,
		});
	});

	test("a failed fetch and a non-manifest payload are values, never throws", async () => {
		const down = offlineAdapter({
			fetchJson: async () => {
				throw new Error("ENOTFOUND");
			},
		});
		expect(await plugin(down).check({ endpoint: "e", currentVersion: "1.0.0" })).toMatchObject({
			available: false,
			error: { code: "check-failed", message: "ENOTFOUND" },
		});
		expect(await check({ hello: "world" }, "1.0.0")).toMatchObject({
			available: false,
			error: { code: "bad-manifest" },
		});
		const noArgs = await plugin(offlineAdapter()).check({} as CheckArgs);
		expect(noArgs).toMatchObject({ available: false, error: { code: "invalid-arguments" } });
	});

	test("the endpoint falls back to the configured one, and a foreign key is refused", async () => {
		const key = await signer();
		const signature = await key.sign("bundle-bytes");
		const manifest = { version: "2.0.0", url: "u.app", signature, pubkey: key.pubkey };
		const adapter = offlineAdapter({ fetchJson: async () => manifest });
		const commands = plugin(adapter, { endpoint: "https://example.test/latest.json" });
		expect(await commands.check({ currentVersion: "1.0.0" } as CheckArgs)).toMatchObject({
			available: true,
			version: "2.0.0",
			signature,
			pubkey: key.pubkey,
		});
		const foreign = await plugin(adapter, {
			endpoint: "https://example.test/latest.json",
			pubkey: Buffer.alloc(32, 1).toString("base64"),
		});
		expect(await foreign.check({ currentVersion: "1.0.0" } as CheckArgs)).toMatchObject({
			available: false,
			error: { code: "bad-manifest" },
		});
	});

	test("config reports the pinned key and whether file urls are allowed", async () => {
		const key = await signer();
		const commands = plugin(offlineAdapter(), { pubkey: key.pubkey, allowFileUrl: true });
		expect(await commands.config()).toEqual({
			endpoint: undefined,
			pubkey: key.pubkey,
			autoCheck: false,
			allowFileUrl: true,
		});
	});
});
