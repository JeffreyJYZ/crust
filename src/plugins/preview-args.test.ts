/**
 * `preview.show`'s argument rules: an absolute path, and a size that is both halves or neither. Each
 * refusal is a `bad-request` naming the field, because a page author reads the message.
 */
import { describe, expect, test } from "bun:test";
import { CrustError } from "@/bridge/errors";
import { readShow } from "@/plugins/preview-args";

function codeOf(run: () => unknown): string {
	try {
		run();
	} catch (error) {
		return error instanceof CrustError ? error.code : "not-a-crust-error";
	}
	return "no-throw";
}

const ABSOLUTE = "/tmp/report.docx";

describe("preview.show arguments", () => {
	test("a relative path is refused by name", () => {
		expect(codeOf(() => readShow({ path: "report.docx" }))).toBe("bad-request");
	});

	test("a missing or empty path is refused", () => {
		expect(codeOf(() => readShow({}))).toBe("bad-request");
		expect(codeOf(() => readShow({ path: "" }))).toBe("bad-request");
		expect(codeOf(() => readShow(null))).toBe("bad-request");
	});

	test("an absolute path with no size takes the config's pair", () => {
		expect(readShow({ path: ABSOLUTE }, { width: 640, height: 480 })).toEqual({
			path: ABSOLUTE,
			width: 640,
			height: 480,
		});
	});

	test("no size anywhere answers 0, which the panel reads as its own", () => {
		expect(readShow({ path: ABSOLUTE })).toEqual({
			path: ABSOLUTE,
			width: 0,
			height: 0,
		});
	});

	test("a page's own pair wins over the config", () => {
		expect(
			readShow({ path: ABSOLUTE, width: 300, height: 200 }, { width: 640, height: 480 }),
		).toEqual({
			path: ABSOLUTE,
			width: 300,
			height: 200,
		});
	});

	test("one-sided size is refused rather than starting a blank panel", () => {
		expect(codeOf(() => readShow({ path: ABSOLUTE, width: 300 }))).toBe("bad-request");
		expect(codeOf(() => readShow({ path: ABSOLUTE, height: 300 }))).toBe("bad-request");
	});

	test("a size must be a positive integer, not a string or a fraction", () => {
		expect(codeOf(() => readShow({ path: ABSOLUTE, width: "300", height: 200 }))).toBe(
			"bad-request",
		);
		expect(codeOf(() => readShow({ path: ABSOLUTE, width: 300.5, height: 200 }))).toBe(
			"bad-request",
		);
		expect(codeOf(() => readShow({ path: ABSOLUTE, width: 0, height: 0 }))).toBe("bad-request");
	});
});
