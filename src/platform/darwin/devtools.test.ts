/**
 * The inspector is gated on a dev-only env flag and cannot launch a window here, so the proof is
 * the gate's truth table, the Objective-C the shim receives, and that `crust dev` sets the flag.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DEV_INSPECT_ENV, devInspectEnabled } from "./devtools.ts";
import { SHIM_PART_NAMES } from "./shim-source.ts";

const source = SHIM_PART_NAMES.map((name) =>
	readFileSync(join(import.meta.dir, "shim", name), "utf8"),
).join("\n");

describe("dev-only WebKit inspector", () => {
	test("the gate opens only on the exact dev-only value", () => {
		expect(DEV_INSPECT_ENV).toBe("CRUST_DEV_INSPECT");
		expect(devInspectEnabled({})).toBe(false);
		expect(devInspectEnabled({ [DEV_INSPECT_ENV]: "0" })).toBe(false);
		expect(devInspectEnabled({ [DEV_INSPECT_ENV]: "true" })).toBe(false);
		expect(devInspectEnabled({ [DEV_INSPECT_ENV]: "1" })).toBe(true);
	});

	test("the C sets developerExtrasEnabled and guards setInspectable", () => {
		const fn = source.slice(source.indexOf("void shim_webview_enable_devtools"));
		expect(fn).toContain('__CFStringMakeConstantString("developerExtrasEnabled")');
		expect(fn).toContain('sel_registerName("setValue:forKey:")');
		expect(fn).toContain('sel_registerName("respondsToSelector:")');
		expect(fn).toContain('sel_registerName("setInspectable:")');
	});

	test("crust dev sets and clears the flag", () => {
		const dev = readFileSync(join(import.meta.dir, "../../cli/dev.ts"), "utf8");
		expect(dev).toContain('process.env[DEV_INSPECT_ENV] = "1"');
		expect(dev).toContain("delete process.env[DEV_INSPECT_ENV]");
	});
});
