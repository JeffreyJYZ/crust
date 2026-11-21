/**
 * The environment block's bytes, proven without Windows. An ERROR_INVALID_PARAMETER (87) from
 * CreateProcessW on windows-latest 2026-11-21 came from a UTF-16 block handed over without
 * CREATE_UNICODE_ENVIRONMENT and a locale-aware sort; the byte shape here is the local half.
 */
import { describe, expect, test } from "bun:test";
import { environmentBlock } from "./pty-conpty.ts";

describe("the CreateProcessW environment block", () => {
	test("entries are separated by one NUL, sorted by case-insensitive Unicode name", () => {
		const bytes = Buffer.from(
			environmentBlock({ term: "dumb", PATH: "C:\\bin", TERM: "xterm" }),
		);
		// PATH, TERM, term — `localeCompare("en")` ordered the lowercase name differently.
		expect(bytes.toString("utf16le")).toBe("PATH=C:\\bin\0TERM=xterm\0term=dumb\0\0");
	});

	test("the block ends in two UTF-16 NULs, including when it has no entries", () => {
		const full = Buffer.from(environmentBlock({ TERM: "xterm" }));
		expect(full.subarray(-4)).toEqual(Buffer.alloc(4));
		const empty = Buffer.from(environmentBlock({}));
		expect(empty.toString("utf16le")).toBe("\0\0");
		expect(empty.length).toBe(4);
	});

	test("names carrying '=' are dropped, not handed to CreateProcessW", () => {
		const bytes = Buffer.from(environmentBlock({ "=C:": "C:\\", TERM: "xterm" }));
		expect(bytes.toString("utf16le")).toBe("TERM=xterm\0\0");
	});
});
