/**
 * The C unit behind `crust:menu` compiles, links AppKit and exports exactly what the adapter calls. Nothing here builds or opens a menu: `begin` answers 0 until a click target exists, and that refusal is the whole native proof a suite can make without a human.
 */

import { describe, expect, test } from "bun:test";
import { menuUnit } from "./menu-api.ts";

const SYMBOLS = [
	"menu_api_begin",
	"menu_api_close",
	"menu_api_install",
	"menu_api_is_default",
	"menu_api_item",
	"menu_api_popup",
	"menu_api_read",
	"menu_api_read_enabled",
	"menu_api_read_has_submenu",
	"menu_api_read_key",
	"menu_api_read_mask",
	"menu_api_read_parent",
	"menu_api_read_title",
	"menu_api_separator",
	"menu_api_submenu",
	"menu_api_tag",
	"menu_api_target",
];

describe("98_menu_api.c with 98_menu_read.c and 99_menu_context.c", () => {
	test("compile through cc() as one unit and export every symbol the adapter binds", () => {
		expect(Object.keys(menuUnit().symbols).sort()).toEqual(SYMBOLS);
	});

	test("a null sender and a missing window are refused, never crash", () => {
		const { symbols } = menuUnit();
		expect(Number(symbols.menu_api_tag(0))).toBe(-1);
		expect(Number(symbols.menu_api_popup(0, 0))).toBe(0);
		expect(Number(symbols.menu_api_close())).toBe(0);
		// `begin` and `install` are not asserted here: a bar another file in this same
		// process built leaves the click target installed, so their refusal is not a
		// fresh-process fact. `menu-readback.test.ts` proves both positively instead.
	});

	test("a row index no read produced answers empty, never a stale row", () => {
		const { symbols } = menuUnit();
		expect(String(symbols.menu_api_read_title(-1))).toBe("");
		expect(String(symbols.menu_api_read_key(99))).toBe("");
		expect(Number(symbols.menu_api_read_parent(-1))).toBe(-2);
		expect(Number(symbols.menu_api_read_mask(99))).toBe(-1);
		expect(Number(symbols.menu_api_is_default(0, 0))).toBe(0);
	});
});
