/**
 * `crust dev` injects the page client through Vite, so this is the one path where a
 * page could be handed the process token. The process token may seed a document for
 * any label; a page that holds it can mint another window's grants. The plugin must
 * hand the page a document token the bridge minted and bound instead.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { BRIDGE_TOKEN_VAR, BRIDGE_URL_VAR, crust } from "./vite.ts";
import { start, stopAll } from "./bridge/server/fixtures.ts";

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
	test("the process token is never injected into the page", async () => {
		const bridge = start();
		process.env[BRIDGE_URL_VAR] = bridge.url;
		process.env[BRIDGE_TOKEN_VAR] = bridge.token;
		const config = await injected();
		expect(config).toBeDefined();
		expect(config?.url).toBe(bridge.url);
		expect(config?.token).not.toBe(bridge.token);
	});

	test("the injected token cannot mint a document for another label", async () => {
		const bridge = start();
		process.env[BRIDGE_URL_VAR] = bridge.url;
		process.env[BRIDGE_TOKEN_VAR] = bridge.token;
		const config = await injected();
		if (config === undefined) throw new Error("no config injected");
		const served = await fetch(`${bridge.url}/?token=${config.token}&window=admin`, {
			redirect: "manual",
		});
		// A document token re-serves its own document: 200, no mint, no authority change.
		expect(served.status).toBe(200);
		expect(served.headers.get("location")).toBeNull();
	});

	test("without a bridge nothing is injected", async () => {
		delete process.env[BRIDGE_URL_VAR];
		delete process.env[BRIDGE_TOKEN_VAR];
		process.env.CRUST_DEV_FILE = "/definitely/missing/dev.json";
		expect(await injected()).toBeUndefined();
	});
});
