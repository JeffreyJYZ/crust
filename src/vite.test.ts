/**
 * `crust dev` injects the page client through Vite, and the runtime mints the credential once
 * where the bridge is bound. The plugin must inject that document token verbatim — with no fetch,
 * no round trip and no race — and the token it injects must be able to invoke but never to seed.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { start, stopAll } from "./bridge/server/fixtures.ts";
import { BRIDGE_TOKEN_VAR, BRIDGE_URL_VAR, crust } from "./vite.ts";

afterEach(() => {
	delete process.env[BRIDGE_URL_VAR];
	delete process.env[BRIDGE_TOKEN_VAR];
	delete process.env.CRUST_DEV_FILE;
	return stopAll();
});

/** The hook shape this test reads; Vite's own types allow void, string and tag-array results. */
interface Tag {
	tag?: string;
	children?: unknown;
}
interface HtmlHook {
	transformIndexHtml: {
		handler: (html: string, ctx: unknown) => Promise<{ tags?: Tag[] } | string | undefined>;
	};
}

/** The injected `window.__CRUST__` assignment, or undefined when the plugin injected nothing. */
async function injected(): Promise<{ url: string; token: string } | undefined> {
	const plugin = crust() as unknown as HtmlHook;
	const result = await plugin.transformIndexHtml.handler("<html><head></head></html>", {});
	const tags =
		result !== undefined && typeof result === "object" && "tags" in result
			? (result.tags ?? [])
			: [];
	const script = tags.find(
		(tag) =>
			tag.tag === "script" &&
			typeof tag.children === "string" &&
			tag.children.includes("__CRUST__"),
	);
	const children = script?.children;
	if (typeof children !== "string") return undefined;
	const match = /window\.__CRUST__ = (\{.*?\});/s.exec(children);
	return match === null
		? undefined
		: (JSON.parse(match[1] ?? "{}") as { url: string; token: string });
}

describe("the dev page's credential", () => {
	test("the plugin injects its document token verbatim, with no fetch in the path", async () => {
		const bridge = start();
		const pageToken = bridge.mintPageToken();
		process.env[BRIDGE_URL_VAR] = bridge.url;
		process.env[BRIDGE_TOKEN_VAR] = pageToken;

		const originalFetch = globalThis.fetch;
		globalThis.fetch = (() => {
			throw new Error("transformIndexHtml must not touch the network");
		}) as unknown as typeof fetch;
		try {
			expect(await injected()).toEqual({ url: bridge.url, token: pageToken });
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	test("window.__CRUST__ carries a token the bridge accepts but that cannot seed", async () => {
		const bridge = start();
		process.env[BRIDGE_URL_VAR] = bridge.url;
		process.env[BRIDGE_TOKEN_VAR] = bridge.mintPageToken();
		const config = await injected();
		if (config === undefined) throw new Error("no config injected");

		// A real credential for the document route (200, no redirect).
		const served = await fetch(`${bridge.url}/?token=${config.token}`, { redirect: "manual" });
		expect(served.status).toBe(200);
		expect(served.headers.get("location")).toBeNull();

		// A document token re-serves its own document: no mint, no authority change.
		const tried = await fetch(`${bridge.url}/?token=${config.token}&window=admin`, {
			redirect: "manual",
		});
		expect(tried.status).toBe(200);
		expect(tried.headers.get("location")).toBeNull();
	});

	test("without a handshake or environment nothing is injected", async () => {
		delete process.env[BRIDGE_URL_VAR];
		delete process.env[BRIDGE_TOKEN_VAR];
		process.env.CRUST_DEV_FILE = "/definitely/missing/dev.json";
		expect(await injected()).toBeUndefined();
	});
});
