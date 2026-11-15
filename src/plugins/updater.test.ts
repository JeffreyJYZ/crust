import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	type CheckArgs,
	type CheckResult,
	createUpdaterPlugin,
	type DownloadResult,
	nodeUpdaterAdapter,
	type UpdaterAdapter,
	type UpdaterFailure,
	type UpdaterOptions,
} from "@/plugins/updater";

function offlineAdapter(overrides: Partial<UpdaterAdapter> = {}): UpdaterAdapter {
	const no = () => Promise.reject(new Error("a test tried to reach the network"));
	const fake = { ...nodeUpdaterAdapter(), fetchJson: no, download: no, relaunch: no };
	return { ...fake, ...overrides };
}

function plugin(adapter: UpdaterAdapter, options: UpdaterOptions = {}) {
	return createUpdaterPlugin(adapter, options).commands;
}

async function check(manifest: unknown, currentVersion: string): Promise<CheckResult> {
	const adapter = offlineAdapter({ fetchJson: async () => manifest });
	return await plugin(adapter).check({ endpoint: "e", currentVersion });
}

function writing(payload: string): UpdaterAdapter {
	return offlineAdapter({
		download: async (_url, directory) => {
			const path = join(directory, "Notes.app");
			await writeFile(path, payload);
			return { path, bytes: payload.length };
		},
	});
}

/** A real Ed25519 pair from WebCrypto: the same primitive the plugin verifies with. */
async function signer(): Promise<{
	pubkey: string;
	sign: (payload: string) => Promise<string>;
}> {
	const pair = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, [
		"sign",
		"verify",
	])) as unknown as CryptoKeyPair;
	const raw = await crypto.subtle.exportKey("raw", pair.publicKey);
	const pubkey = Buffer.from(raw).toString("base64");
	return {
		pubkey,
		sign: async (payload) => {
			const signature = await crypto.subtle.sign(
				{ name: "Ed25519" },
				pair.privateKey,
				new TextEncoder().encode(payload),
			);
			return Buffer.from(signature).toString("base64");
		},
	};
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

	test("the endpoint falls back to the configured one, and the signature travels on", async () => {
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
});

describe("updater.download", () => {
	const payload = "bundle-bytes";
	const digest = createHash("sha256").update(payload).digest("hex");

	test("writes into a temp dir, verifies a given digest, and refuses a mismatch", async () => {
		const hashed = { url: "u.app", sha256: digest };
		const result = (await plugin(writing(payload)).download(hashed)) as DownloadResult;
		expect(result).toMatchObject({ ok: true, bytes: payload.length, sha256: digest });
		expect(result.path.startsWith(tmpdir())).toBe(true);
		expect(await readFile(result.path, "utf8")).toBe(payload);

		const plain = (await plugin(writing(payload)).download({ url: "u.app" })) as DownloadResult;
		expect(plain.sha256).toBeUndefined();

		const wrong = (await plugin(writing(payload)).download({
			url: "u.app",
			sha256: "0".repeat(64),
		})) as UpdaterFailure;
		expect(wrong).toMatchObject({ ok: false, code: "hash-mismatch" });
		expect(wrong.path?.endsWith("Notes.app")).toBe(true);
	});

	test("an Ed25519 signature over the artifact bytes verifies, and tampered bytes do not", async () => {
		const key = await signer();
		const signature = await key.sign(payload);
		const signed = { url: "u.app", signature, pubkey: key.pubkey };
		const result = (await plugin(writing(payload)).download(signed)) as DownloadResult;
		expect(result).toMatchObject({ ok: true, bytes: payload.length });

		const tampered = (await plugin(writing("swapped-bytes")).download(
			signed,
		)) as UpdaterFailure;
		expect(tampered).toMatchObject({ ok: false, code: "signature-mismatch" });
		expect(tampered.path?.endsWith("Notes.app")).toBe(true);
	});

	test("a configured pubkey is used when the page names none, and cannot be replaced", async () => {
		const key = await signer();
		const signature = await key.sign(payload);
		const pinned = plugin(writing(payload), { pubkey: key.pubkey });
		expect(await pinned.download({ url: "u.app", signature })).toMatchObject({ ok: true });

		const loose = plugin(writing(payload));
		expect(await loose.download({ url: "u.app", signature })).toMatchObject({
			ok: false,
			code: "invalid-arguments",
		});
		const foreign = Buffer.alloc(32, 2).toString("base64");
		expect(await pinned.download({ url: "u.app", signature, pubkey: foreign })).toMatchObject({
			ok: false,
			code: "invalid-arguments",
		});
	});
});
