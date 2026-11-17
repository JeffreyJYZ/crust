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

describe("value-taking flags", () => {
	test("a following flag is not eaten as the value", () => {
		const parsed = parse(["init", "--dir", "--react"]);
		expect(parsed.error).toBe("--dir needs a value");
		expect(parsed.options.dir).not.toBe("--react");
	});

	test("--help after a value flag still prints help", () => {
		const parsed = parse(["init", "--dir", "--help"]);
		expect(parsed.help).toBe(true);
		expect(parsed.error).toBeUndefined();
		expect(parsed.options.dir).not.toBe("--help");
	});

	test("--version after --format is not a format value", () => {
		const parsed = parse(["package", "--format", "--version"]);
		expect(parsed.version).toBe(true);
		expect(parsed.error).toBeUndefined();
	});
});

describe("global help and version", () => {
	test("--help short-circuits --react validation", () => {
		const parsed = parse(["--help", "--react"]);
		expect(parsed.help).toBe(true);
		expect(parsed.error).toBeUndefined();
	});

	test("--version short-circuits --format validation", () => {
		const parsed = parse(["--version", "--format", "dmg"]);
		expect(parsed.version).toBe(true);
		expect(parsed.error).toBeUndefined();
	});

	test("--help with an unknown option still prints help", () => {
		const parsed = parse(["--help", "--bogus"]);
		expect(parsed.help).toBe(true);
		expect(parsed.error).toBeUndefined();
	});
});
