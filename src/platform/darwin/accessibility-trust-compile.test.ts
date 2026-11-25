/**
 * `trusted()` must not say "AX not granted" when the native unit never compiled — that would send a
 * person into System Settings for a permission they already gave. The mock is installed before the
 * adapter is imported, so the module under test binds the failing unit rather than the real one.
 */

import { describe, expect, mock, test } from "bun:test";

mock.module("./accessibility-ffi.ts", () => ({
	accessibilityUnit: () => {
		throw new Error("TinyCC could not compile the AX unit");
	},
	accessibilityUnitStatus: () => "failed",
	ACCESSIBILITY_SYMBOL_NAMES: [],
	accessibilitySource: "",
}));

const { darwinAccessibilityAdapter } = await import("./accessibility.ts");

describe("darwin trusted() on a native compile failure", () => {
	test("throws a named refusal instead of returning false", () => {
		const adapter = darwinAccessibilityAdapter();
		expect(() => adapter.trusted()).toThrow(/TinyCC could not compile the AX unit/);
		try {
			adapter.trusted();
		} catch (error) {
			expect((error as { code?: string }).code).toBe("native-unavailable");
		}
	});
});
