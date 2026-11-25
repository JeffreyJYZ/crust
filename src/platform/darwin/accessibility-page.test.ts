/**
 * The real page unit: `106_accessibility_page.c` must compile through `cc()`, link AppKit and
 * ApplicationServices, and answer honestly with no window up.
 *
 * Nothing here moves focus or raises a dialog: `crust_ax_focus` is only called through the adapter on a
 * process that has no window, so it answers 0 rather than stealing the human's keyboard. The
 * announcement is posted because posting is the thing being proven, and an announcement is exactly what
 * a screen reader reads without taking focus away from anyone.
 */

import { describe, expect, test } from "bun:test";

import {
	ACCESSIBILITY_PAGE_SYMBOL_NAMES,
	accessibilityPageUnit,
	accessibilityPageUnitStatus,
	darwinAccessibilityAdapter,
} from "@/platform/darwin/accessibility.ts";
import { cstr } from "@/platform/darwin/objc.ts";

describe("106_accessibility_page.c", () => {
	test("compiles through cc(), links both frameworks, exports the declared symbols", () => {
		const compiled = accessibilityPageUnit();
		expect(accessibilityPageUnitStatus()).toEqual({ available: true, reason: "compiled" });
		expect(Object.keys(compiled.symbols).sort()).toEqual(
			[
				...ACCESSIBILITY_PAGE_SYMBOL_NAMES,
				"shim_audit_balance",
				"shim_audit_bump",
				"shim_audit_events",
				"shim_audit_reset",
			].sort(),
		);
		for (const name of ACCESSIBILITY_PAGE_SYMBOL_NAMES) {
			expect(typeof (compiled.symbols as unknown as Record<string, unknown>)[name]).toBe(
				"function",
			);
		}
	});

	test("announce answers 1 for real text and 0 for empty text", () => {
		const unit = accessibilityPageUnit();
		expect(Number(unit.symbols.crust_ax_announce(cstr("crust announce test"), 0))).toBe(1);
		expect(Number(unit.symbols.crust_ax_announce(cstr("crust announce assertive"), 1))).toBe(1);
		expect(Number(unit.symbols.crust_ax_announce(cstr(""), 0))).toBe(0);
	});

	test("title and focus answer 0 when no window carries the name", () => {
		const unit = accessibilityPageUnit();
		expect(Number(unit.symbols.crust_ax_title(cstr("name"), cstr("no-such-window")))).toBe(0);
		expect(Number(unit.symbols.crust_ax_focus(cstr("no-such-window")))).toBe(0);
	});
});

describe("the adapter relays the page unit", () => {
	test("announce reports the post rather than a spoken string", async () => {
		const adapter = darwinAccessibilityAdapter();
		const report = await adapter.announce?.("crust adapter announce", "polite");
		expect(report?.announced).toBe(true);
		expect(report?.reason).toContain("AXAnnouncementRequested");
	});

	test("title and focus name the window they could not reach", async () => {
		const adapter = darwinAccessibilityAdapter();
		const titled = await adapter.title?.("label", "absent-window");
		expect(titled?.titled).toBe(false);
		expect(titled?.reason).toContain("absent-window");
		const focused = await adapter.focus?.("absent-window");
		expect(focused?.focused).toBe(false);
		expect(focused?.reason).toContain("absent-window");
	});
});
