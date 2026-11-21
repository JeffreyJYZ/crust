/**
 * A refused AXChildren used to report status `noWindowsListed`: C returned -1, the same sentinel as
 * an empty AXWindows list, so a permission failure looked like an app with no accessible tree.
 * Only -1 may mean "no windows"; every other negative is a refusal.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { AX_STATUS, axElementReport } from "./accessibility.ts";

describe("AX element count status", () => {
	test("an empty AXWindows list is the only -1 answer", () => {
		expect(axElementReport("empty", -1)).toEqual({
			count: 0,
			status: AX_STATUS.noWindowsListed,
			reason: "empty",
		});
	});

	test("AXWindows and AXChildren refusals are reported as refusals", () => {
		for (const answer of [-2, -3]) {
			expect(axElementReport("AX denied", answer)).toEqual({
				count: 0,
				status: AX_STATUS.refused,
				reason: "AX denied",
			});
		}
	});

	test("the C unit gives AXChildren its own sentinel", () => {
		const source = readFileSync(join(import.meta.dir, "shim/106_accessibility.c"), "utf8");
		expect(source).toContain("count = -3;");
		expect(source).toMatch(/AXChildren[\s\S]{0,240}count = -3;/);
	});
});
