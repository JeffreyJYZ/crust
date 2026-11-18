/** The shared boundary rule for both C units: a Cocoa object is never handed to C's free(). */

import { describe, expect, test } from "bun:test";

import { DOWNLOADS, NETWORK, read } from "./ownership-harness";

describe("no Cocoa object is handed to free()", () => {
	test("the four C parts release through -release only", () => {
		const code = [...NETWORK, ...DOWNLOADS]
			.map(read)
			.join("\n")
			.split("\n")
			.filter((line) => !line.trimStart().startsWith("//"))
			.join("\n");
		expect(code).not.toMatch(/\bfree\s*\(/);
		expect(code).toContain('sel_registerName("release")');
	});
});
