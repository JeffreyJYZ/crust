/**
 * Recorded audio is played back from a `blob:` URL, and `media-src` falls back to `default-src`
 * (`'self'`), so a shipped policy without `media-src` refuses the take and reads as the framework
 * blocking voice. The served document is asserted, not only the string.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { DEFAULT_CSP, defaultCsp, devCspNotice } from "./csp.ts";
import { start, stopAll, testPlugin } from "./fixtures.ts";

afterEach(stopAll);

const DOCUMENT =
	"<!doctype html><html><head><title>x</title></head><body><h1>app</h1></body></html>";

describe("media-src", () => {
	test("the default policy admits a blob: media source", () => {
		expect(DEFAULT_CSP).toContain("media-src 'self' blob:");
	});

	test("a served document carries it, beside a nonce script-src", async () => {
		const bridge = start({ handlers: [testPlugin], indexHtml: DOCUMENT });
		const response = await fetch(`${bridge.url}/?token=${bridge.token}`);
		const csp = response.headers.get("content-security-policy") ?? "";
		expect(csp).toContain("media-src 'self' blob:");
		expect(csp).toContain("'nonce-");
		expect(defaultCsp("n1")).toContain("media-src 'self' blob:");
	});
});

describe("devCspNotice", () => {
	test("names the dev server and the default policy a build will enforce", () => {
		const notice = devCspNotice("http://localhost:5173", undefined);
		expect(notice).toContain("http://localhost:5173");
		expect(notice).toContain("no CSP in dev");
		expect(notice).toContain("connect-src 'self'");
	});

	test("names the app's own policy when one is configured", () => {
		const notice = devCspNotice("http://localhost:5173", "default-src 'none'");
		expect(notice).toContain("your security.csp");
		expect(notice).not.toContain("connect-src 'self'");
	});
});
