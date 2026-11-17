/**
 * The served document's policy carries a per-response nonce, and the inline bootstrap is the only
 * script that nonce admits. `'unsafe-inline'` in `script-src` is what let an injected `<script>` run,
 * so its absence is asserted here rather than left to a browser.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { DEFAULT_CSP, defaultCsp, nonceSource, stampInlineScripts } from "./csp.ts";
import { start, stopAll, testPlugin } from "./fixtures.ts";

afterEach(stopAll);

const DOCUMENT =
	"<!doctype html><html><head><title>x</title></head><body><h1>app</h1></body></html>";

function nonceOf(html: string): string | null {
	return /<script nonce="([^"]+)"/.exec(html)?.[1] ?? null;
}

function cspOf(response: Response): string {
	return response.headers.get("content-security-policy") ?? "";
}

async function documentOf(bridge: ReturnType<typeof start>): Promise<Response> {
	return await fetch(`${bridge.url}/?token=${bridge.token}`);
}

describe("script nonce", () => {
	test("the bootstrap carries a nonce and the header admits the same value", async () => {
		const bridge = start({ handlers: [testPlugin], indexHtml: DOCUMENT });
		const response = await documentOf(bridge);
		const nonce = nonceOf(await response.text());
		expect(nonce).not.toBeNull();
		expect(cspOf(response)).toContain(`'nonce-${nonce}'`);
	});

	test("two responses never share a nonce", async () => {
		const bridge = start({ handlers: [testPlugin], indexHtml: DOCUMENT });
		const first = nonceOf(await (await documentOf(bridge)).text());
		const second = nonceOf(await (await documentOf(bridge)).text());
		expect(first).not.toBeNull();
		expect(second).not.toBeNull();
		expect(first).not.toBe(second);
	});

	test("the same document served twice does not reuse the first nonce", async () => {
		const bridge = start({ handlers: [testPlugin], indexHtml: DOCUMENT });
		const nonces = new Set<string>();
		for (let i = 0; i < 4; i++) {
			const nonce = nonceOf(await (await documentOf(bridge)).text());
			expect(nonce).not.toBeNull();
			nonces.add(nonce as string);
		}
		expect(nonces.size).toBe(4);
	});

	test("script-src carries no 'unsafe-inline', and style-src still does", async () => {
		const bridge = start({ handlers: [testPlugin], indexHtml: DOCUMENT });
		const csp = cspOf(await documentOf(bridge));
		const scriptSrc = csp
			.split(";")
			.map((part) => part.trim())
			.find((part) => part.startsWith("script-src"));
		expect(scriptSrc).toBeDefined();
		expect(scriptSrc).not.toContain("'unsafe-inline'");
		expect(csp).toContain("style-src 'self' 'unsafe-inline'");
		expect(DEFAULT_CSP).not.toContain("script-src 'self' 'unsafe-inline'");
	});

	test("an inline script the page did not author is not granted permission", async () => {
		// The page's own markup holds a second inline script, and a payload appended to the
		// document (what an injection produces) carries no nonce: neither is admitted.
		const page =
			"<!doctype html><html><head><script>window.page = 1;</script></head><body></body></html>";
		const bridge = start({ handlers: [testPlugin], indexHtml: page });
		const response = await documentOf(bridge);
		const html = await response.text();
		const csp = cspOf(response);
		// The authored tag is stamped, so exactly the two nonce values the header names — the
		// document's and the bootstrap's — are legal, and a bare `<script>` tag is not.
		const nonces = [...html.matchAll(/<script nonce="([^"]+)"/g)].map((match) => match[1]);
		expect(nonces.length).toBe(2);
		for (const nonce of nonces) expect(csp).toContain(`'nonce-${nonce}'`);
		expect(csp).not.toMatch(/script-src[^;]*'unsafe-inline'/);
		expect(csp).not.toMatch(/script-src[^;]*\*/);
	});

	test("stampInlineScripts leaves a src-only tag and an existing nonce alone", () => {
		const stamped = stampInlineScripts(
			'<script src="/app.js"></script><script nonce="mine">a()</script><script>b()</script>',
			"n1",
		);
		expect(stamped).toContain('<script src="/app.js"></script>');
		expect(stamped).toContain('<script nonce="mine">a()</script>');
		expect(stamped).toContain('<script nonce="n1">b()</script>');
	});

	test("a config csp wins whole, and the nonce is still generated", async () => {
		const bridge = start({
			handlers: [testPlugin],
			indexHtml: DOCUMENT,
			csp: "default-src 'none'",
		});
		const response = await documentOf(bridge);
		expect(cspOf(response)).toBe("default-src 'none'");
		expect(nonceOf(await response.text())).not.toBeNull();
	});

	test("the nonce is 16 random bytes in base64, and two draws differ", () => {
		const first = nonceSource();
		const second = nonceSource();
		expect(Buffer.from(first, "base64").byteLength).toBe(16);
		expect(first).not.toBe(second);
		expect(defaultCsp(first)).toContain(`script-src 'self' 'nonce-${first}'`);
		expect(defaultCsp(first)).toContain("style-src 'self' 'unsafe-inline'");
	});
});
