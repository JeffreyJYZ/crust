/**
 * The document route and the dev-origin policy: what a page gets without a
 * token, and what a configured dev origin is allowed to do.
 */

import { afterEach, describe, expect, test } from "bun:test";
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

describe("document", () => {
	test("the document is served without a token and carries the CSP", async () => {
		const bridge = start({
			handlers: [testPlugin],
			indexHtml: "<!doctype html><html><head><title>x</title></head><body></body></html>",
		});
		const response = await fetch(`${bridge.url}/`);
		expect(response.status).toBe(200);
		expect(response.headers.get("content-type")).toContain("text/html");
		const csp = response.headers.get("content-security-policy") ?? "";
		expect(csp).toContain("default-src 'self'");
		expect(csp).toContain("connect-src 'self'");
		expect(response.headers.get("x-content-type-options")).toBe("nosniff");
		expect(response.headers.get("referrer-policy")).toBe("no-referrer");
	});

	test("the token is injected into index.html and nowhere else", async () => {
		const bridge = start({
			handlers: [testPlugin],
			indexHtml: "<!doctype html><html><head></head><body><h1>app</h1></body></html>",
			assets: { "/assets/app.js": "export const answer = 42;" },
		});
		const document = await (await fetch(`${bridge.url}/`)).text();
		expect(document).toContain("__CRUST__");
		expect(document).toContain("/_crust/invoke");
		expect(document).toContain(bridge.token);
		expect(document).toContain("baseUrl");

		const assetResponse = await fetch(`${bridge.url}/assets/app.js`);
		expect(assetResponse.status).toBe(200);
		expect(assetResponse.headers.get("content-type")).toContain("text/javascript");
		const asset = await assetResponse.text();
		expect(asset).toBe("export const answer = 42;");
		expect(asset).not.toContain(bridge.token);
	});

	test("a custom csp replaces the measured default", async () => {
		const bridge = start({ handlers: [testPlugin], csp: "default-src 'none'" });
		const response = await fetch(`${bridge.url}/`);
		expect(response.headers.get("content-security-policy")).toBe("default-src 'none'");
	});

	test("an unknown path is a structured 404", async () => {
		const bridge = start();
		const response = await fetch(`${bridge.url}/nope`, {
			headers: { origin: ownOrigin(bridge), authorization: `Bearer ${bridge.token}` },
		});
		expect(response.status).toBe(404);
		const body = await readJson(response);
		expect(body.error.code).toBe("not-found");
	});
});

const DEV_ORIGIN = "http://localhost:5173";

describe("dev origin", () => {
	test("preflight answers 204 with the measured CORS headers", async () => {
		const bridge = start({ handlers: [testPlugin], devOrigin: DEV_ORIGIN });
		const response = await fetch(`${bridge.url}/_crust/invoke`, {
			method: "OPTIONS",
			headers: { origin: DEV_ORIGIN },
		});
		expect(response.status).toBe(204);
		expect(response.headers.get("access-control-allow-origin")).toBe(DEV_ORIGIN);
		expect(response.headers.get("access-control-allow-methods")).toBe("POST, GET, OPTIONS");
		expect(response.headers.get("access-control-allow-headers")).toBe(
			"authorization, content-type",
		);
		expect(response.headers.get("access-control-max-age")).toBe("600");
		expect(response.headers.get("vary")).toBe("origin");
	});

	test("a configured dev origin may call, and its response echoes the origin", async () => {
		const bridge = start({ handlers: [testPlugin], devOrigin: DEV_ORIGIN });
		const response = await invoke(bridge, {
			"content-type": "application/json",
			origin: DEV_ORIGIN,
			authorization: `Bearer ${bridge.token}`,
		});
		expect(response.status).toBe(200);
		expect(response.headers.get("access-control-allow-origin")).toBe(DEV_ORIGIN);
		expect(response.headers.get("vary")).toBe("origin");
	});

	test("a foreign origin stays 403 even with a dev origin configured", async () => {
		const bridge = start({ handlers: [testPlugin], devOrigin: DEV_ORIGIN });
		const response = await invoke(bridge, {
			"content-type": "application/json",
			origin: "http://127.0.0.2:1",
			authorization: `Bearer ${bridge.token}`,
		});
		expect(response.status).toBe(403);
	});

	test("the served page still gets no CORS header with a dev origin configured", async () => {
		const bridge = start({ handlers: [testPlugin], devOrigin: DEV_ORIGIN });
		const response = await fetch(`${bridge.url}/`, { headers: { origin: ownOrigin(bridge) } });
		expect(response.headers.get("access-control-allow-origin")).toBeNull();
	});
});
