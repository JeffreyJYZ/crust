import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";

import type { DownloadArgs, DownloadResult, UpdaterFailure } from "@/plugins/updater";
import { offlineAdapter, plugin, signer, UPDATE_URL, writing } from "@/plugins/updater-fake";

const payload = "bundle-bytes";
const digest = createHash("sha256").update(payload).digest("hex");

describe("updater.download", () => {
	test("writes into a temp dir, verifies the digest, and refuses a mismatch", async () => {
		const result = (await plugin(writing(payload)).download({
			url: UPDATE_URL,
			sha256: digest,
		})) as DownloadResult;
		expect(result).toMatchObject({ ok: true, bytes: payload.length, sha256: digest });
		expect(result.path.startsWith(tmpdir())).toBe(true);
		expect(await readFile(result.path, "utf8")).toBe(payload);

		const wrong = (await plugin(writing(payload)).download({
			url: UPDATE_URL,
			sha256: "0".repeat(64),
		})) as UpdaterFailure;
		expect(wrong).toMatchObject({ ok: false, code: "hash-mismatch" });
		expect(wrong.path?.endsWith("Notes.app.zip")).toBe(true);
	});

	test("finding 3: a page-chosen url is fetched only over https", async () => {
		const plain = (await plugin(writing(payload)).download({
			url: "http://example.test/Notes.app.zip",
			sha256: digest,
		})) as UpdaterFailure;
		expect(plain).toMatchObject({ ok: false, code: "invalid-arguments" });
		expect(plain.message).toContain("refuses a http: url");

		const relative = (await plugin(writing(payload)).download({
			url: "u.app",
			sha256: digest,
		})) as UpdaterFailure;
		expect(relative.message).toContain("needs an absolute url");
	});

	test("finding 3: file: needs the config's opt-in, and is refused by name without it", async () => {
		const local = "file:///Users/jyz/Downloads/Notes.app.zip";
		const refused = (await plugin(writing(payload)).download({
			url: local,
			sha256: digest,
		})) as UpdaterFailure;
		expect(refused).toMatchObject({ ok: false, code: "invalid-arguments" });
		expect(refused.requires).toBe("updater.allowFileUrl");
		expect(refused.message).toContain("updater.allowFileUrl");

		const allowed = (await plugin(writing(payload), { allowFileUrl: true }).download({
			url: local,
			sha256: digest,
		})) as DownloadResult;
		expect(allowed).toMatchObject({ ok: true, sha256: digest });
	});

	test("finding 3: sha256 is required, so nothing unverified is ever written", async () => {
		const adapter = offlineAdapter({
			download: async () => {
				throw new Error("the adapter must not be reached without a digest");
			},
		});
		const refused = (await plugin(adapter).download({
			url: UPDATE_URL,
		} as DownloadArgs)) as UpdaterFailure;
		expect(refused).toMatchObject({ ok: false, code: "invalid-arguments" });
		expect(refused.requires).toBe("sha256");
		expect(refused.message).toContain("requires sha256");

		const bad = (await plugin(adapter).download({
			url: UPDATE_URL,
			sha256: "not-hex",
		})) as UpdaterFailure;
		expect(bad).toMatchObject({ ok: false, code: "invalid-arguments" });
		expect(bad.requires).toBe("sha256");
	});

	test("finding 2: the caller's own key is never used, and no key is named instead", async () => {
		const attacker = await signer();
		const signature = await attacker.sign(payload);
		const adapter = offlineAdapter({
			download: async () => {
				throw new Error("the adapter must not be reached without a pinned key");
			},
		});
		const selfSigned = (await plugin(adapter).download({
			url: UPDATE_URL,
			sha256: digest,
			signature,
			pubkey: attacker.pubkey,
		})) as UpdaterFailure;
		expect(selfSigned).toMatchObject({ ok: false, code: "invalid-arguments" });
		expect(selfSigned.requires).toBe("updater.pubkey");
		expect(selfSigned.message).toContain("requires updater.pubkey");
	});

	test("finding 2: a pinned key cannot be replaced by the one a page ships", async () => {
		const app = await signer();
		const attacker = await signer();
		const signature = await attacker.sign(payload);
		const commands = plugin(writing(payload), { pubkey: app.pubkey });
		const foreign = (await commands.download({
			url: UPDATE_URL,
			sha256: digest,
			signature,
			pubkey: attacker.pubkey,
		})) as UpdaterFailure;
		expect(foreign).toMatchObject({ ok: false, code: "invalid-arguments" });
		expect(foreign.message).toContain("refuses a pubkey that is not this app's");
	});

	test("a signature over the artifact verifies with the pinned key, and tampered bytes do not", async () => {
		const key = await signer();
		const signature = await key.sign(payload);
		const signed = { url: UPDATE_URL, sha256: digest, signature };
		const pinned = plugin(writing(payload), { pubkey: key.pubkey });
		expect(await pinned.download(signed)).toMatchObject({ ok: true, signer: key.pubkey });

		const tampered = (await plugin(writing("swapped-bytes"), {
			pubkey: key.pubkey,
		}).download({
			...signed,
			sha256: createHash("sha256").update("swapped-bytes").digest("hex"),
		})) as UpdaterFailure;
		expect(tampered).toMatchObject({ ok: false, code: "signature-mismatch" });
		expect(tampered.path?.endsWith("Notes.app.zip")).toBe(true);
	});
});
