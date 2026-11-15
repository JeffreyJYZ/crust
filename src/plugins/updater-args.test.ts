import { describe, expect, test } from "bun:test";

import { compareVersions, isNewer } from "@/plugins/updater-args";
import { parseManifest } from "@/plugins/updater-manifest";

const pubkey = Buffer.alloc(32, 7).toString("base64");
const signature = Buffer.alloc(64, 9).toString("base64");

describe("compareVersions", () => {
	test("compares segments numerically, and a pre-release sorts below its release", () => {
		const cases: Array<[string, string, number]> = [
			["0.10.0", "0.9.0", 1],
			["0.9.0", "0.10.0", -1],
			["1.99.99", "2.0.0", -1],
			["1.2", "1.2.0", 0],
			["v1.2.3", "1.2.3", 0],
			["1.0.0", "1.0.0-beta.1", 1],
			["1.0.0-alpha", "1.0.0-beta", -1],
		];
		for (const [left, right, order] of cases) expect(compareVersions(left, right)).toBe(order);
		expect(isNewer("1.2.1", "1.2")).toBe(true);
		expect(isNewer("1.2", "1.2.0")).toBe(false);
	});
});

describe("parseManifest", () => {
	test("reads a full manifest and refuses one without version, url or a good sha256", () => {
		const digest = "AB".repeat(32);
		const source = { version: "1.4.0", notes: "x", url: "u", sha256: digest };
		const parsed = parseManifest(source);
		expect(parsed).toEqual({ ok: true, manifest: { ...source, sha256: digest.toLowerCase() } });
		expect(parseManifest({ url: "u.app" })).toMatchObject({ ok: false });
		expect(parseManifest({ version: "1.0.0" })).toMatchObject({ ok: false });
		expect(parseManifest(null)).toMatchObject({ ok: false });
		expect(parseManifest({ version: "1", url: "u", sha256: "nope" })).toMatchObject({
			ok: false,
			reason: '"sha256" must be 64 hex characters',
		});
	});

	test("takes signature and pubkey only as a pair, and only when both decode", () => {
		const signed = parseManifest({ version: "1", url: "u", signature, pubkey });
		expect(signed).toEqual({
			ok: true,
			manifest: { version: "1", url: "u", signature, pubkey },
		});
		expect(parseManifest({ version: "1", url: "u", signature })).toMatchObject({
			ok: false,
			reason: '"pubkey" must be base64 of 32 bytes',
		});
		expect(parseManifest({ version: "1", url: "u", pubkey })).toMatchObject({ ok: false });
		expect(parseManifest({ version: "1", url: "u", signature, pubkey: "short" })).toMatchObject(
			{ ok: false },
		);
	});
});
