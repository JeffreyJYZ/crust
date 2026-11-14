import { describe, expect, test } from "bun:test";
import { JIT_ENTITLEMENT_PLIST } from "./sign";

/**
 * A hardened-runtime bundle without these keys is a *silent* failure: the app
 * launches, creates no page and prints nothing, with exit status 0. Measured on
 * 2026-11-14 with an Apple Development identity, so both keys are asserted here
 * rather than trusted to a comment.
 */
describe("hardened runtime entitlements", () => {
	test("seals allow-jit", () => {
		expect(JIT_ENTITLEMENT_PLIST).toContain("<key>com.apple.security.cs.allow-jit</key>");
	});

	test("seals unsigned executable memory, which TinyCC needs", () => {
		expect(JIT_ENTITLEMENT_PLIST).toContain(
			"<key>com.apple.security.cs.allow-unsigned-executable-memory</key>",
		);
	});

	test("is a plist with one dict and a trailing newline", () => {
		expect(JIT_ENTITLEMENT_PLIST.startsWith('<?xml version="1.0"')).toBe(true);
		expect(JIT_ENTITLEMENT_PLIST.endsWith("</plist>\n")).toBe(true);
		expect(JIT_ENTITLEMENT_PLIST.match(/<dict>/g)?.length).toBe(1);
	});
});
