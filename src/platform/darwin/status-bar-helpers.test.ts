/**
 * The pure halves of the status-bar family: marshalling, C-to-JS readback and
 * the declared ABI names. The adapter itself is driven in `status-bar-item.test.ts`;
 * these are the invariants a fake shim can prove without AppKit.
 */
import { describe, expect, test } from "bun:test";
import { cbuf, checked, ptrValue } from "./status-bar-args.ts";
import { readbackFrom } from "./status-bar-readback.ts";
import {
	STATUS_BAR_SYMBOL_NAMES,
	type LooseSymbol,
	type StatusBarSymbolName,
} from "./status-bar-symbols.ts";

describe("status-bar marshalling", () => {
	test("cbuf caches a NUL-terminated UTF-8 buffer and counts bytes", () => {
		const first = cbuf("hello");
		expect(cbuf("hello")).toBe(first);
		expect(first.len).toBe(5);
		expect(first.p).toBeGreaterThan(0);
		// UTF-8 bytes, not UTF-16 code units.
		expect(cbuf("é").len).toBe(2);
		expect(cbuf("").len).toBe(0);
	});

	test("ptrValue refuses coercion of a mangled pointer", () => {
		expect(ptrValue(42, "tray_create")).toBe(42);
		expect(() => ptrValue(undefined, "tray_create")).toThrow(/returned undefined/);
		expect(() => ptrValue(2n, "tray_create")).toThrow(/returned bigint/);
		expect(() => ptrValue("0x10", "tray_create")).toThrow(/returned string/);
	});

	test("checked names the call AppKit refused", () => {
		expect(() => checked(1, "setTitle")).not.toThrow();
		expect(() => checked(0, "setTitle")).toThrow(/setTitle was refused by AppKit/);
		expect(() => checked(undefined, "show")).toThrow(/show was refused by AppKit/);
	});
});

/** A shim with every declared symbol present, overridable per test. */
function shim(overrides: Partial<Record<StatusBarSymbolName, LooseSymbol>> = {}) {
	const symbols = Object.fromEntries(
		STATUS_BAR_SYMBOL_NAMES.map((name) => [name, () => 0]),
	) as Record<StatusBarSymbolName, LooseSymbol>;
	return { symbols: { ...symbols, ...overrides } };
}

describe("status-bar ABI names", () => {
	test("the declared symbol list is unique and covers the adapter's calls", () => {
		expect(STATUS_BAR_SYMBOL_NAMES.length).toBe(21);
		expect(new Set(STATUS_BAR_SYMBOL_NAMES).size).toBe(STATUS_BAR_SYMBOL_NAMES.length);
		for (const name of [
			"tray_create",
			"tray_set_title",
			"tray_title_copy",
			"tray_set_visible",
			"tray_menu_activate",
			"tray_item_index",
			"tray_destroy",
		]) {
			expect([...STATUS_BAR_SYMBOL_NAMES] as string[]).toContain(name);
		}
	});
});

describe("status-bar readback", () => {
	test("a missing selector maps to null, never false or zero", () => {
		const readback = readbackFrom(
			shim({
				tray_item_visible: () => -1,
				tray_item_length: () => -1,
				tray_button_window_visible: () => -1,
				tray_button_window_occlusion: () => -1,
				tray_button_window_active_space: () => -1,
				tray_button_window_frame: () => 0,
				tray_title_copy: () => "A title",
			}),
			1,
		);
		expect(readback.title).toBe("A title");
		expect(readback.visible).toBeNull();
		expect(readback.length).toBeNull();
		expect(readback.windowVisible).toBeNull();
		expect(readback.occlusion).toBeNull();
		expect(readback.onActiveSpace).toBeNull();
		expect(readback.frame).toBeNull();
		expect(readback.windowNumber).toBe(0);
	});

	test("flags, window number and frame are copied out of C as primitives", () => {
		const readback = readbackFrom(
			shim({
				tray_title_copy: () => "crust",
				tray_item_visible: () => 1,
				tray_item_length: () => 78.5,
				tray_button_window: () => 42,
				tray_button_window_visible: () => 1,
				tray_button_window_frame: (_target, out) => {
					(out as Float64Array).set([1, 2, 3, 4]);
					return 1;
				},
				tray_button_window_occlusion: () => 2,
				tray_button_window_active_space: () => 1,
			}),
			9,
		);
		expect(readback.title).toBe("crust");
		expect(readback.visible).toBe(true);
		expect(readback.length).toBe(78.5);
		expect(readback.windowNumber).toBe(42);
		expect(readback.windowVisible).toBe(true);
		expect(readback.frame).toEqual({ x: 1, y: 2, width: 3, height: 4 });
		expect(readback.occlusion).toBe(2);
		expect(readback.onActiveSpace).toBe(true);
	});
});
