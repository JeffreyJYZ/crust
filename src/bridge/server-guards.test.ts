/**
 * The server's input guards: what a hostile or broken client can push through the asset route and
 * the invoke boundary. Every case here was a review finding with no test behind it, so each one
 * states the exact shape that used to pass.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assetBody } from "./server/assets.ts";
import { MAX_BODY_BYTES } from "./server/invoke.ts";
import {
	headers,
	invoke,
	ownOrigin,
	readJson,
	start,
	stopAll,
	testPlugin,
} from "./server/fixtures.ts";

afterEach(stopAll);

const OUTSIDE = "SECRET-OUTSIDE-THE-ASSET-ROOT";

/** A root with one public file, and a secret one directory above it. */
function assetRoot(): { root: string; cleanup(): void } {
	const base = mkdtempSync(join(tmpdir(), "crust-assets-"));
	const root = join(base, "public");
	mkdirSync(root, { recursive: true });
	writeFileSync(join(root, "app.js"), "export const ok = 1;");
	writeFileSync(join(base, "secret.txt"), OUTSIDE);
	return { root, cleanup: () => rmSync(base, { recursive: true, force: true }) };
}

describe("asset path traversal", () => {
	test("a %5c-encoded parent segment is refused, not resolved by the Windows separator", async () => {
		const { root, cleanup } = assetRoot();
		try {
			// The decoded key is `/..\..\secret.txt`; splitting on `/` alone saw one harmless part.
			await expect(
				assetBody("/..%5c..%5csecret.txt", { root, handlers: [] }),
			).rejects.toMatchObject({ code: "bad-request" });
		} finally {
			cleanup();
		}
	});

	test("a %2e%2e%5c parent segment is refused too", async () => {
		const { root, cleanup } = assetRoot();
		try {
			await expect(
				assetBody("/%2e%2e%5csecret.txt", { root, handlers: [] }),
			).rejects.toMatchObject({ code: "bad-request" });
		} finally {
			cleanup();
		}
	});

	test("an ordinary asset inside the root still loads", async () => {
		const { root, cleanup } = assetRoot();
		try {
			const body = await assetBody("/app.js", { root, handlers: [] });
			expect(await (body as Blob).text()).toBe("export const ok = 1;");
		} finally {
			cleanup();
		}
	});

	test("the route refuses a traversal request instead of serving the secret", async () => {
		const { root, cleanup } = assetRoot();
		try {
			const bridge = start({ handlers: [testPlugin], root });
			const response = await fetch(`${bridge.url}/..%5c..%5csecret.txt`);
			expect(response.status).toBe(400);
			expect(await response.text()).not.toContain(OUTSIDE);
		} finally {
			cleanup();
		}
	});
});

describe("invoke body guards", () => {
	test("a malformed JSON body is a structured 400 bad-json", async () => {
		const bridge = start();
		const response = await fetch(`${bridge.url}/_crust/invoke`, {
			method: "POST",
			headers: headers(bridge, { authorization: `Bearer ${bridge.token}` }),
			body: "{not json",
		});
		expect(response.status).toBe(400);
		expect((await readJson(response)).error.code).toBe("bad-json");
	});

	test("a body over the cap is a 413 too-large", async () => {
		const bridge = start();
		const response = await invoke(
			bridge,
			headers(bridge, { authorization: `Bearer ${bridge.token}` }),
			{ plugin: "test", command: "echo", args: "x".repeat(MAX_BODY_BYTES + 1) },
		);
		expect(response.status).toBe(413);
		expect((await readJson(response)).error.code).toBe("too-large");
	});

	test("a chunked body over the cap is refused before the rest of the stream arrives", async () => {
		const bridge = start();
		// A streamed POST carries `transfer-encoding: chunked` and no content-length, so the
		// header fast path cannot see the size. The old code buffered to the end before applying
		// the cap; the fix counts raw bytes while streaming and refuses as soon as it crosses.
		let openGate!: () => void;
		const gate = new Promise<void>((resolve) => {
			openGate = resolve;
		});
		let first = true;
		const body = new ReadableStream<Uint8Array>({
			async pull(controller) {
				try {
					if (first) {
						first = false;
						controller.enqueue(new Uint8Array(MAX_BODY_BYTES + 1));
						return;
					}
					await gate;
					controller.enqueue(new TextEncoder().encode("tail"));
					controller.close();
				} catch {
					// The bridge cancelled the stream after refusing the first chunk.
				}
			},
		});
		const pending = fetch(`${bridge.url}/_crust/invoke`, {
			method: "POST",
			headers: headers(bridge, { authorization: `Bearer ${bridge.token}` }),
			body,
		});
		let answered = false;
		void pending.then(
			() => {
				answered = true;
			},
			() => {},
		);
		try {
			await Bun.sleep(500);
			expect(answered).toBe(true);
		} finally {
			openGate();
		}
		const response = await pending;
		expect(response.status).toBe(413);
		expect((await readJson(response)).error.code).toBe("too-large");
	});

	test("a multibyte body under the character count but over the byte cap is 413", async () => {
		const bridge = start();
		// `length` counts UTF-16 units, so this measures ~700 k units and ~2.1 MB on the wire.
		const args = "中".repeat(Math.ceil(MAX_BODY_BYTES / 3) + 1);
		expect(args.length).toBeLessThan(MAX_BODY_BYTES);
		expect(Buffer.byteLength(args)).toBeGreaterThan(MAX_BODY_BYTES);
		const response = await invoke(
			bridge,
			headers(bridge, { authorization: `Bearer ${bridge.token}` }),
			{ plugin: "test", command: "echo", args },
		);
		expect(response.status).toBe(413);
		expect((await readJson(response)).error.code).toBe("too-large");
	});

	test("a binary invoke without ?plugin= and ?command= is a 400 bad-request", async () => {
		const bridge = start();
		const response = await fetch(`${bridge.url}/_crust/invoke`, {
			method: "POST",
			headers: {
				origin: ownOrigin(bridge),
				authorization: `Bearer ${bridge.token}`,
				"content-type": "application/octet-stream",
			},
			body: new Uint8Array([1, 2, 3]),
		});
		expect(response.status).toBe(400);
		expect((await readJson(response)).error.code).toBe("bad-request");
	});
});
