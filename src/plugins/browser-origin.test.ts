/**
 * The origin gate on its own: normalisation, the port, and the near-miss hosts a prefix check would
 * wrongly allow. These are the cases a browser allow list exists for, so they are asserted without
 * going through the plugin.
 */
import { describe, expect, test } from "bun:test";
import { originOf, originPolicy } from "@/plugins/browser-origin";

describe("originOf", () => {
	test("an origin is scheme, host and port — never a path", () => {
		expect(originOf("https://Example.com/app?x=1#y")).toBe("https://example.com");
		expect(originOf("http://127.0.0.1:4321/page")).toBe("http://127.0.0.1:4321");
	});

	test("only http and https have an origin here", () => {
		expect(originOf("file:///etc/passwd")).toBe(undefined);
		expect(originOf("data:text/html,hi")).toBe(undefined);
		expect(originOf("about:blank")).toBe(undefined);
		expect(originOf("not a url")).toBe(undefined);
	});

	test("a default port normalises away, an explicit different one does not", () => {
		expect(originOf("https://example.com:443/")).toBe("https://example.com");
		expect(originOf("https://example.com:8443/")).toBe("https://example.com:8443");
	});
});

describe("originPolicy.refusal", () => {
	test("a lookalike host is refused, because the comparison is an origin not a prefix", () => {
		const policy = originPolicy({ origins: ["https://example.com"] });
		expect(policy.refusal("https://example.com.evil.test/", "open")).toMatchObject({
			code: "bad-request",
		});
		expect(policy.refusal("https://example.com:8443/", "open")).toMatchObject({
			code: "bad-request",
		});
	});

	test("the refusal names the origin and the list, so the fix is visible", () => {
		const policy = originPolicy({ origins: ["https://example.com"] });
		const answer = policy.refusal("https://other.test/", "navigate");
		expect(answer?.message).toContain("origin https://other.test");
		expect(answer?.message).toContain("https://example.com");
	});
});
