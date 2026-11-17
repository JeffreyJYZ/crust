/**
 * The served document's inline scripts are exactly what the policy admits, and the bootstrap's body
 * is its own source.
 *
 * The bootstrap used to be injected as a whole `<script>…</script>` element *inside* another one.
 * The parser ends the outer element at the inner `</script>`, so the page received
 * `<script nonce="…"><script>(function installCrust(…` and threw `Unexpected token '<'` — the window
 * loaded, `window.crust` never existed, and every page command was missing with no error on screen.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { start, stopAll, testPlugin } from "./fixtures.ts";

afterEach(stopAll);

const DOCUMENT =
	"<!doctype html><html><head><title>x</title><script>window.authored = 1;</script></head>" +
	"<body><h1>app</h1></body></html>";

/** Every inline `<script>` body the page's own parser would run, in order. */
function inlineBodies(html: string): string[] {
	return [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map(
		(match) => match[1] ?? "",
	);
}

async function served(): Promise<{ html: string; csp: string }> {
	const bridge = start({ handlers: [testPlugin], indexHtml: DOCUMENT });
	const response = await fetch(`${bridge.url}/?token=${bridge.token}`);
	return {
		html: await response.text(),
		csp: response.headers.get("content-security-policy") ?? "",
	};
}

describe("a served document's inline scripts", () => {
	test("the bootstrap is one script element, never a script inside a script", async () => {
		const { html } = await served();
		// The whole failure in one assertion: a nested tag ends the outer element early.
		expect(html).not.toMatch(/<script[^>]*>\s*<script/i);
		const bodies = inlineBodies(html);
		expect(bodies.length).toBe(2);
		// The bootstrap's body is the client itself, so it starts with the function that installs it.
		expect(bodies.some((body) => body.includes("installCrust"))).toBe(true);
	});

	test("every inline body parses as JavaScript", async () => {
		const { html } = await served();
		for (const body of inlineBodies(html)) {
			// A truncated body is the injected-nesting symptom; parsing it here is the measurement.
			expect(() => new Function(body)).not.toThrow();
		}
	});

	test("both inline tags carry the nonce the header admits", async () => {
		const { html, csp } = await served();
		const nonces = [...html.matchAll(/<script nonce="([^"]+)"/gi)].map((match) => match[1]);
		expect(nonces.length).toBe(2);
		for (const nonce of nonces) expect(csp).toContain(`'nonce-${nonce}'`);
	});
});
