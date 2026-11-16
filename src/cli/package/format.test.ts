import { describe, expect, test } from "bun:test";
import { FORMATS, parseFormats } from "./format";

describe("parseFormats", () => {
	test("no --format at all means dmg", () => {
		expect(parseFormats([])).toEqual({ ok: true, formats: ["dmg"] });
	});

	test("keeps the order the user gave and builds a repeated format once", () => {
		expect(parseFormats(["nsis", "dmg", "nsis"])).toEqual({
			ok: true,
			formats: ["nsis", "dmg"],
		});
	});

	test("names every accepted format when the value is unknown", () => {
		const parsed = parseFormats(["zip"]);
		expect(parsed.ok).toBe(false);
		if (parsed.ok) throw new Error("expected a refusal");
		expect(parsed.error).toBe(`unknown format "zip" — expected ${FORMATS.join(" | ")}`);
	});

	test("every listed format parses", () => {
		for (const format of FORMATS)
			expect(parseFormats([format])).toEqual({ ok: true, formats: [format] });
	});
});
