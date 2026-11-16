/**
 * The matcher `crust:network` decides with, proven on its own: a pattern is a literal or a glob with
 * one metacharacter, never a regular expression, so a page cannot hand the main thread a catastrophic
 * backtrack.
 */

import { describe, expect, test } from "bun:test";

import { patternMatches } from "@/plugins/network.ts";

describe("network pattern", () => {
	test("a literal pattern must equal the URL", () => {
		expect(patternMatches("https://a.example/x", "https://a.example/x")).toBe(true);
		expect(patternMatches("https://a.example/x", "https://a.example/y")).toBe(false);
		expect(patternMatches("https://a.example/x", "https://a.example/x/")).toBe(false);
	});

	test("a trailing star matches any run, and only as a suffix", () => {
		expect(patternMatches("https://a.example/*", "https://a.example/deep/x")).toBe(true);
		expect(patternMatches("*.png", "https://a.example/x.png")).toBe(true);
		expect(patternMatches("*.png", "https://a.example/x.png?v=1")).toBe(false);
	});

	test("a star in the middle is anchored on both literal ends", () => {
		expect(patternMatches("https://a.*/x", "https://a.example/x")).toBe(true);
		expect(patternMatches("https://a.*/x", "https://b.example/x")).toBe(false);
		expect(patternMatches("crust-net://*/api/*", "crust-net://app/api/users")).toBe(true);
	});

	test("one star alone allows everything, and a regex metacharacter is a literal", () => {
		expect(patternMatches("*", "crust-net://anything")).toBe(true);
		expect(patternMatches("(", "(")).toBe(true);
		expect(patternMatches(".*", ".x")).toBe(true);
		expect(patternMatches(".*", "x.y")).toBe(false);
	});
});
