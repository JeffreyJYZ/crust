/**
 * The bounds the default adapter puts on a response: a byte cap, so an endless body cannot fill the
 * temp dir, and a redirect policy, so "only https" covers the bytes fetched and not just the URL
 * handed in. GitHub Releases answers `latest/download/…` with a 302 to its object store, so a hop has
 * to be allowed while a plaintext one still is not; the injected `fetch` keeps each hop checkable.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { UpdaterAdapterError } from "@/plugins/updater-args";
import {
	MAX_DOWNLOAD_BYTES,
	MAX_REDIRECT_HOPS,
	readBounded,
	fetchFollowing,
	type RedirectFetch,
} from "@/plugins/updater-fetch";
import { nodeUpdaterAdapter } from "@/plugins/updater-node";

let server: ReturnType<typeof Bun.serve>;
let base = "";

const RELEASE = "https://github.com/owner/app/releases/latest/download/Notes.app.zip";
const OBJECT = "https://objects.githubusercontent.com/asset/Notes.app.zip?sig=1";

function moved(location: string): Response {
	return new Response(null, { status: 302, headers: { location } });
}

beforeAll(() => {
	server = Bun.serve({
		port: 0,
		fetch(request) {
			const { pathname } = new URL(request.url);
			if (pathname === "/moved") {
				return moved("http://127.0.0.1:1/Notes.app.zip");
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
	test("a GitHub Releases 302 is followed to the https object it names", async () => {
		const seen: string[] = [];
		const fetchImpl: RedirectFetch = async (url) => {
			seen.push(url);
			if (url === RELEASE) return moved(OBJECT);
			return new Response("bundle-bytes", { status: 200 });
		};
		const response = await fetchFollowing(RELEASE, {}, fetchImpl);
		expect(response.status).toBe(200);
		expect(await response.text()).toBe("bundle-bytes");
		expect(seen).toEqual([RELEASE, OBJECT]);
	});

	test("a 302 to http is refused before a plaintext request is made", async () => {
		const seen: string[] = [];
		const fetchImpl: RedirectFetch = async (url) => {
			seen.push(url);
			return moved("http://127.0.0.1:1/Notes.app.zip");
		};
		const refused = (await fetchFollowing(RELEASE, {}, fetchImpl).catch(
			(error: unknown) => error,
		)) as UpdaterAdapterError;
		expect(refused).toBeInstanceOf(UpdaterAdapterError);
		expect(refused.code).toBe("download-failed");
		expect(refused.message).toContain("http://127.0.0.1:1/Notes.app.zip");
		expect(refused.message).toContain("only https is followed");
		expect(seen).toHaveLength(1);
	});

	test("a redirect loop stops at the hop bound instead of running free", async () => {
		let requests = 0;
		const fetchImpl: RedirectFetch = async () => {
			requests += 1;
			return moved(`https://loop.test/${requests}`);
		};
		const refused = (await fetchFollowing(RELEASE, {}, fetchImpl).catch(
			(error: unknown) => error,
		)) as UpdaterAdapterError;
		expect(refused).toBeInstanceOf(UpdaterAdapterError);
		expect(refused.message).toContain(`more than ${MAX_REDIRECT_HOPS} redirects`);
		expect(requests).toBe(MAX_REDIRECT_HOPS + 1);
	});

	test("the adapter wires both commands through the same policy", async () => {
		const url = `${base}/moved`;
		const refused = (await nodeUpdaterAdapter()
			.download(url, "/tmp")
			.catch((error: unknown) => error)) as UpdaterAdapterError;
		expect(refused).toBeInstanceOf(UpdaterAdapterError);
		expect(refused.code).toBe("download-failed");
		expect(refused.message).toContain("only https is followed");
		// The policy claim is explicit: the run says why, instead of quietly fetching cleartext.
		expect(refused.message).toContain("http://127.0.0.1:1/Notes.app.zip");

		const checked = (await nodeUpdaterAdapter()
			.fetchJson(url)
			.catch((error: unknown) => error)) as UpdaterAdapterError;
		expect(checked).toBeInstanceOf(UpdaterAdapterError);
		expect(checked.message).toContain("only https is followed");

		// A plain 200 still answers, so the refusal is the hop and not every request.
		expect(await nodeUpdaterAdapter().fetchJson(`${base}/json`)).toMatchObject({
			version: "2.0.0",
		});
	});

	test("a declared content-length over the cap refuses before the body is read", async () => {
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

	test("a body over the cap is stopped while it streams, header or not", async () => {
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

	test("the default cap is the one named when no limit is passed", async () => {
		const response = new Response(new Uint8Array(1), {
			headers: { "content-length": String(MAX_DOWNLOAD_BYTES + 1) },
		});
		const refused = (await readBounded(response, "https://example.test/a.zip").catch(
			(error: unknown) => error,
		)) as UpdaterAdapterError;
		expect(refused).toBeInstanceOf(UpdaterAdapterError);
		expect(refused.message).toContain(`${MAX_DOWNLOAD_BYTES} byte cap`);
	});

	test("a 200 is not a redirect, so the refusal is selective", async () => {
		const ok = await fetch(`${base}/plain`, { redirect: "manual" });
		expect(ok.status).toBe(200);
	});
});
