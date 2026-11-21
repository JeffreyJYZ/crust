/**
 * cac turns a repeated boolean flag into an array. translate and validate must read
 * the same normalised value, or a command reports success for a stage or scaffold it
 * did not run. Combined short flags must still answer help/version.
 */
import { describe, expect, test } from "bun:test";
import { flagValue, globalFlags, translate, validate } from "./argv.ts";

describe("flag normalisation", () => {
	test("an array of true is the same as a single boolean flag", () => {
		expect(flagValue({ sign: [true, true] }, "sign")).toBe(true);
		expect(flagValue({ sign: true }, "sign")).toBe(true);
		expect(flagValue({ sign: undefined }, "sign")).toBe(false);
		expect(flagValue({ sign: [true, false] }, "sign")).toBe(false);
	});

	test("repeated stage and scaffold flags survive translation", () => {
		const built = translate("build", undefined, { sign: [true, true], dmg: [true, true] });
		expect(built.sign).toBe(true);
		expect(built.dmg).toBe(true);
		const init = translate("init", undefined, { react: [true, true] });
		expect(init.react).toBe(true);
	});

	test("validation uses the normalised value for scope checks", () => {
		expect(validate("init", [], { sign: [true, true] })).toBe("--sign only applies to build");
		expect(validate("build", [], { sign: [true, true] })).toBeUndefined();
	});

	test("a combined -hv answers help and version", () => {
		expect(
			globalFlags(["init", "-hv"], { h: true, v: true, help: true, version: true }),
		).toEqual({ help: true, version: true });
		expect(globalFlags(["--version"], { version: true })).toEqual({
			help: false,
			version: true,
		});
	});
});
