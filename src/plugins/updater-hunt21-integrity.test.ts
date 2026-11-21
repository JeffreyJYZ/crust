/** hunt-21 updater integrity: a pinned key gates, and neither the archive nor the feed is unbounded. */

import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";

import type { UpdaterFailure } from "@/plugins/updater";
import {
	offlineAdapter,
	plugin,
	signer,
	shipping,
	UPDATE_URL,
	writing,
} from "@/plugins/updater-fake";
import { MAX_INFLATED_BYTES, readArchive } from "@/plugins/updater-archive";
import { MANIFEST_BYTES, readJsonBounded } from "@/plugins/updater-fetch";
import { isEd25519Pubkey, samePubkey } from "@/plugins/updater-signature";
import { buildZip, bundleZip } from "@/plugins/updater-zip-fixture";

const payload = "bundle-bytes";
const digest = createHash("sha256").update(payload).digest("hex");

/** Patch one central directory entry's uncompressed-size field (+24). */
function declare(bytes: Uint8Array, size: number, index = 0): Uint8Array {
	const copy = bytes.slice();
	const view = new DataView(copy.buffer, copy.byteOffset, copy.byteLength);
	let central = view.getUint32(copy.length - 22 + 16, true);
	for (let at = 0; at < index; at += 1) {
		central +=
			46 +
			view.getUint16(central + 28, true) +
			view.getUint16(central + 30, true) +
			view.getUint16(central + 32, true);
	}
	view.setUint32(central + 24, size, true);
	return copy;
}

describe("a pinned updater.pubkey is a gate", () => {
	test("a signed-capable app refuses an unsigned artifact before the adapter is reached", async () => {
		const key = await signer();
		const adapter = offlineAdapter({
			download: async () => {
				throw new Error("the adapter must not fetch an unsigned artifact");
			},
		});
		const result = (await plugin(adapter, { pubkey: key.pubkey }).download({
			url: UPDATE_URL,
			sha256: digest,
		})) as UpdaterFailure;
		expect(result).toMatchObject({ ok: false, code: "invalid-arguments" });
		expect(result.requires).toBe("signature");
		expect(result.message).toContain("updater.pubkey");
	});

	test("an app with no pinned key may still download with a digest alone", async () => {
		const result = await plugin(writing(payload)).download({ url: UPDATE_URL, sha256: digest });
		expect(result).toMatchObject({ ok: true, sha256: digest });
	});
});

describe("key canonicalisation", () => {
	test("a non-canonical pubkey is never imported, but two spellings compare equal by bytes", () => {
		const key = Buffer.alloc(32, 3);
		const canonical = key.toString("base64");
		const unpadded = canonical.replace(/=+$/, "");
		expect(isEd25519Pubkey(canonical)).toBe(true);
		expect(isEd25519Pubkey(unpadded)).toBe(false);
		expect(samePubkey(canonical, canonical)).toBe(true);
		expect(samePubkey(canonical, Buffer.alloc(32, 4).toString("base64"))).toBe(false);
	});
});

describe("archive bounds and symlink redirects", () => {
	test("a declared size over the cap is refused before inflating", () => {
		const hostile = declare(bundleZip(), MAX_INFLATED_BYTES + 1);
		expect(() => readArchive(hostile)).toThrow(/over the .* cap/);
	});

	test("a deflate stream larger than its declared size is refused", () => {
		const bytes = buildZip([
			{ name: "Notes.app/", mode: 0o755 },
			{ name: "Notes.app/Contents/blob.txt", body: "a".repeat(100_000), deflate: true },
		]);
		expect(() => readArchive(bytes)).not.toThrow();
		expect(() => readArchive(declare(bytes, 10, 1))).toThrow(/inflated to 100000 bytes/);
	});

	test("an entry below a symlink is refused, because writes would follow it", () => {
		const bytes = buildZip([
			{ name: "Notes.app/", mode: 0o755 },
			{ name: "Notes.app/Contents/MacOS/", mode: 0o755 },
			{ name: "Notes.app/Contents/MacOS/Notes", body: "#!/bin/sh\n", mode: 0o755 },
			{ name: "Notes.app/Contents/evil", link: "MacOS" },
			{ name: "Notes.app/Contents/evil/Notes", body: "PWNED" },
		]);
		expect(() => readArchive(bytes)).toThrow(/below symlink/);
	});

	test("a symlink that cycles back to the archive root is refused", () => {
		const bytes = buildZip([
			{ name: "Notes.app/", mode: 0o755 },
			{ name: "Notes.app/Contents/Self", link: ".." },
		]);
		expect(() => readArchive(bytes)).toThrow(/cycles/);
	});

	test("download answers invalid-archive when an entry tries to write through a symlink", async () => {
		const bytes = buildZip([
			{ name: "Notes.app/", mode: 0o755 },
			{ name: "Notes.app/Contents/MacOS/", mode: 0o755 },
			{ name: "Notes.app/Contents/evil", link: "MacOS" },
			{ name: "Notes.app/Contents/evil/Notes", body: "PWNED" },
		]);
		const result = (await plugin(shipping(bytes), {}).download({
			url: UPDATE_URL,
			sha256: createHash("sha256").update(bytes).digest("hex"),
		})) as UpdaterFailure;
		expect(result).toMatchObject({ ok: false, code: "invalid-archive" });
		expect(result.message).toContain("Notes.app.zip");
	});
});

/** A body with no content-length: exactly the feed that used to be read without a cap. */
function endless(size: number): Response {
	const body = new ReadableStream<Uint8Array>({
		start(controller) {
			controller.enqueue(new Uint8Array(size));
			controller.close();
		},
	});
	return new Response(body);
}

describe("manifest feed cap", () => {
	test("fetchJson's shared bounded read refuses an oversized feed", async () => {
		expect(MANIFEST_BYTES).toBeGreaterThan(0);
		await expect(
			readJsonBounded(endless(MANIFEST_BYTES + 1), "https://feed.test"),
		).rejects.toThrow(/byte cap/);
		const ok = await readJsonBounded(new Response('{"version":"1.0.0"}'), "https://feed.test");
		expect(ok).toEqual({ version: "1.0.0" });
	});
});
