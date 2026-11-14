import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ptr } from "bun:ffi";
import { PANEL_KIND, PANEL_STATUS, PREFLIGHT, preflightError, shim } from "./index.ts";

import { SHIM_PART_PATHS } from "./shim-source.ts";

/** The parts, read from disk, in the order the unit compiles. */
const SHIM_PARTS = SHIM_PART_PATHS.map((path) =>
	readFileSync(join(import.meta.dir, "..", "..", "..", path), "utf8"),
);

/** `SHIM_PANEL_NO_RESPONSE` in the shim source: the sheet has not answered yet. */
const SHIM_PANEL_NO_RESPONSE = -1;

/** A `const char *` argument, since a JS string cannot cross into C. */
function cstr(s: string): number {
	return ptr(new TextEncoder().encode(`${s}\0`));
}

describe("darwin shim", () => {
	test("compiles through cc() and links AppKit", () => {
		const compiled = shim();
		expect(typeof compiled.symbols.shim_window_new).toBe("function");
		expect(typeof compiled.symbols.shim_pump).toBe("function");

		// A C call round-trips: shim_cstr_len is a plain strlen. A JS string
		// cannot cross, so the buffer's address is passed; i64 returns BigInt.
		const bytes = new TextEncoder().encode("crust\0");
		expect(Number(compiled.symbols.shim_cstr_len(ptr(bytes)))).toBe(5);
	});

	test("exports the three open-panel symbols", () => {
		const symbols = shim().symbols;
		expect(typeof symbols.shim_open_panel).toBe("function");
		expect(typeof symbols.shim_open_panel_count).toBe("function");
		expect(typeof symbols.shim_open_panel_path).toBe("function");
	});

	/**
	 * The save panel compiles through `cc()` and answers without a window, the
	 * same way the open panel does. Nothing here touches the screen.
	 */
	test("exports shim_save_panel, which refuses a sheet with no window", () => {
		const symbols = shim().symbols;
		expect(typeof symbols.shim_save_panel).toBe("function");
		const status = Number(
			symbols.shim_save_panel(cstr("crust test"), cstr("note.md"), cstr("md"), 0) ?? -1,
		);
		expect(Object.values(PANEL_STATUS) as number[]).toContain(status);
		expect([
			PANEL_STATUS.noWindow,
			PANEL_STATUS.unsupported,
			PANEL_STATUS.sheetStarted,
		] as number[]).toContain(status);
		expect(status).not.toBe(PANEL_STATUS.picked);
		// The save panel shares the open panel's path storage, and nothing was
		// collected because nothing was shown.
		expect(Number(symbols.shim_open_panel_count() ?? -1)).toBe(0);
		expect(String(symbols.shim_open_panel_path(0))).toBe("");
	});

	/**
	 * The sheet path's whole contract in three reads. Nothing has started a sheet
	 * in this process, so "not answered yet" and "no panel to cancel" are the
	 * answers — and -1 is deliberately not a valid NSModalResponse, so a caller
	 * that reads it can never mistake it for cancel (0).
	 */
	test("exports the sheet reads, and they say 'nothing yet' with no sheet", () => {
		const symbols = shim().symbols;
		expect(typeof symbols.shim_sheet_done).toBe("function");
		expect(typeof symbols.shim_sheet_response).toBe("function");
		expect(typeof symbols.shim_sheet_cancel).toBe("function");
		expect(typeof symbols.shim_sheet_kind).toBe("function");

		expect(Number(symbols.shim_sheet_done() ?? -1)).toBe(0);
		// An i64 return arrives as a BigInt.
		expect(Number(symbols.shim_sheet_response() ?? 0)).toBe(SHIM_PANEL_NO_RESPONSE);
		expect(Number(symbols.shim_sheet_cancel() ?? -1)).toBe(0);
		// No sheet is up, so nothing names a panel class.
		expect(Number(symbols.shim_sheet_kind() ?? -1)).toBe(PANEL_KIND.none);
	});

	/**
	 * The liveness reads are C-side with one fixed prototype each, because they
	 * are the evidence for "this window is gone". A null window is the one input
	 * that must never fault, so every one of them answers 0 for it.
	 */
	test("exports the window liveness reads, each null-safe", () => {
		const symbols = shim().symbols;
		for (const name of [
			"shim_window_number",
			"shim_window_is_visible",
			"shim_window_is_miniaturized",
			"shim_window_is_released_when_closed",
			"shim_window_is_key",
		] as const) {
			expect(typeof symbols[name]).toBe("function");
			expect(Number(symbols[name](0) ?? -1)).toBe(0);
		}
	});

	/**
	 * The non-blocking path with no window. `runModal=0` needs a key window to
	 * sheet on; this process has none, so the shim must refuse before sending
	 * anything — a `-beginSheetModalForWindow:` with a nil window is an ObjC
	 * exception, which is a SIGABRT with no JavaScript error. Nothing here
	 * touches the screen, so no human is needed.
	 */
	test("runModal=0 with no window returns a defined status, not a crash", () => {
		// Five arguments, in the shim's order: title, filter list, dirs, multiple,
		// runModal. Passing four shifts every one and the last becomes non-zero,
		// which opens a real modal picker — measured, and it was my regression.
		const status = Number(
			shim().symbols.shim_open_panel(cstr("crust test"), cstr(""), 0, 0, 0) ?? -1,
		);
		expect(Object.values(PANEL_STATUS) as number[]).toContain(status);
		expect([
			PANEL_STATUS.noWindow,
			PANEL_STATUS.unsupported,
			PANEL_STATUS.sheetStarted,
		] as number[]).toContain(status);
		expect(status).not.toBe(PANEL_STATUS.picked);
		// Nothing was collected, so the path accessor is empty out of range.
		expect(Number(shim().symbols.shim_open_panel_count() ?? -1)).toBe(0);
		expect(String(shim().symbols.shim_open_panel_path(0))).toBe("");
	});
});
describe("selector preflight", () => {
	test("every listed selector resolves on this system", () => {
		const failures = PREFLIGHT.map((entry) => preflightError(entry)).filter(
			(error): error is string => error !== undefined,
		);
		expect(failures).toEqual([]);
	});

	test("class_getClassMethod is never used as an existence test", async () => {
		// The ban is structural: no JS-visible symbol reaches it at all, and the C
		// file does not declare it.
		expect(shim().symbols).not.toHaveProperty("shim_class_method");
		expect(shim().symbols).not.toHaveProperty("shim_class_getClassMethod");

		const c = SHIM_PARTS.join("\n");
		expect(c).not.toContain("class_getClassMethod");
		expect(c).not.toContain("class_getClassMethod(");
		// The intern table and the crash-prone constructor stay deleted: no symbol
		// and no selector literal for either survives in the shim source.
		expect(c).not.toContain('"stringWithUTF8String:');
		expect(c).not.toMatch(/shim_intern_[a-z]+/);
		expect(shim().symbols).not.toHaveProperty("shim_intern_bytes");
	});
});
