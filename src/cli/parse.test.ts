import { describe, expect, test } from "bun:test";
import { parse } from "./parse";

describe("--format", () => {
	test("collects the repeatable values in the order given", () => {
		const parsed = parse(["package", "--format", "nsis", "--format", "appimage"]);
		expect(parsed.error).toBeUndefined();
		expect(parsed.command).toBe("package");
		expect(parsed.options.formats).toEqual(["nsis", "appimage"]);
	});

	test("a bare package leaves the default to the command", () => {
		expect(parse(["package"]).options.formats).toBeUndefined();
	});

	test("rejects a format the command does not build", () => {
		const parsed = parse(["package", "--format", "zip"]);
		expect(parsed.error).toBe('unknown format "zip" — expected dmg | appimage | nsis');
	});

	test("rejects --format on a command that has no formats", () => {
		expect(parse(["dmg", "--format", "dmg"]).error).toBe("--format only applies to package");
	});

	test("a flag with no value is a usage error, not a crash", () => {
		expect(parse(["package", "--format"]).error).toBe("--format needs a value");
	});
});
