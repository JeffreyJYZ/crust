/**
 * The two bounds the default adapter puts on a response: a byte cap, so an endless body cannot fill
 * the temp dir, and a redirect refusal, so "only https" covers the bytes fetched and not just the
 * URL handed in. Both run against a real `Bun.serve` on loopback, because the claim is about what
 * `fetch` actually does.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { UpdaterAdapterError } from "@/plugins/updater-args";
import { MAX_DOWNLOAD_BYTES, readBounded, redirectFailure } from "@/plugins/updater-fetch";
import { nodeUpdaterAdapter } from "@/plugins/updater-node";

let server: ReturnType<typeof Bun.serve>;
let base = "";

beforeAll(() => {
	server = Bun.serve({
		port: 0,
		fetch(request) {
			const { pathname } = new URL(request.url);
			if (pathname === "/moved") {
				return new Response(null, {
					status: 302,
					headers: { location: "http://127.0.0.1:1/Notes.app.zip" },
				});
			}
			if (pathname === "/huge") {
				return new Response("x".repeat(64), { headers: { "content-length": "64" } });
			}
			if (pathname === "/json") {
				return Response.json({ version: "2.0.0" });
			}
			return new Response("bundle-bytes");
		},
	});
	base = `http://127.0.0.1:${server.port}`;
});

afterAll(() => {
	server.stop(true);
});

describe("the default adapter's response bounds", () => {
	test("finding 6: a redirect is refused, never followed to the scheme it names", async () => {
		const url = `${base}/moved`;
		const refused = (await nodeUpdaterAdapter()
			.download(url, "/tmp")
			.catch((error: unknown) => error)) as UpdaterAdapterError;
		expect(refused).toBeInstanceOf(UpdaterAdapterError);
		expect(refused.code).toBe("download-failed");
		expect(refused.message).toContain("follows no redirect");
		// The policy claim is explicit: the run says why, instead of quietly fetching cleartext.
		expect(refused.message).toContain("http://127.0.0.1:1/Notes.app.zip");

		const checked = (await nodeUpdaterAdapter()
			.fetchJson(url)
			.catch((error: unknown) => error)) as UpdaterAdapterError;
		expect(checked).toBeInstanceOf(UpdaterAdapterError);
		expect(checked.message).toContain("follows no redirect");

		// A plain 200 still answers, so the refusal is the redirect and not every request.
		expect(await nodeUpdaterAdapter().fetchJson(`${base}/json`)).toMatchObject({
			version: "2.0.0",
		});
	});

	test("finding 5: a declared content-length over the cap refuses before the body is read", async () => {
		const response = await fetch(`${base}/huge`, { redirect: "manual" });
		const refused = (await readBounded(response, `${base}/huge`, 16).catch(
			(error: unknown) => error,
		)) as UpdaterAdapterError;
		expect(refused).toBeInstanceOf(UpdaterAdapterError);
		expect(refused.code).toBe("download-failed");
		expect(refused.message).toContain("over the 16 byte cap");

		const fine = await readBounded(
			await fetch(`${base}/plain`, { redirect: "manual" }),
			`${base}/plain`,
			1024,
		);
		expect(new TextDecoder().decode(fine)).toBe("bundle-bytes");
	});

	test("finding 5: a body over the cap is stopped while it streams, header or not", async () => {
		const chunks = [new Uint8Array(8), new Uint8Array(8), new Uint8Array(8)];
		const body = new ReadableStream<Uint8Array>({
			start(controller) {
				for (const chunk of chunks) controller.enqueue(chunk);
				controller.close();
			},
		});
		const response = new Response(body);
		expect(response.headers.get("content-length")).toBeNull();
		const refused = (await readBounded(response, "https://example.test/a.zip", 20).catch(
			(error: unknown) => error,
		)) as UpdaterAdapterError;
		expect(refused).toBeInstanceOf(UpdaterAdapterError);
		expect(refused.message).toContain("is over the 20 byte cap");
	});

	test("finding 5: the default cap is the one named when no limit is passed", async () => {
		const response = new Response(new Uint8Array(1), {
			headers: { "content-length": String(MAX_DOWNLOAD_BYTES + 1) },
		});
		const refused = (await readBounded(response, "https://example.test/a.zip").catch(
			(error: unknown) => error,
		)) as UpdaterAdapterError;
		expect(refused).toBeInstanceOf(UpdaterAdapterError);
		expect(refused.message).toContain(`${MAX_DOWNLOAD_BYTES} byte cap`);
	});

	test("finding 6: a 200 is not a redirect, so the refusal is selective", async () => {
		const ok = await fetch(`${base}/plain`, { redirect: "manual" });
		expect(redirectFailure(`${base}/plain`, ok)).toBeUndefined();
	});
});
