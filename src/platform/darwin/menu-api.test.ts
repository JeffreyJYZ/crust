/**
 * The C unit behind `crust:menu` compiles, links AppKit and exports exactly what the adapter calls. Nothing here builds or opens a menu: `begin` answers 0 until a click target exists, and that refusal is the whole native proof a suite can make without a human.
 */

import { describe, expect, test } from "bun:test";
import { menuUnit } from "./menu-api.ts";

const SYMBOLS = [
	"menu_api_begin",
	"menu_api_close",
	"menu_api_install",
	"menu_api_item",
	"menu_api_popup",
	"menu_api_separator",
	"menu_api_submenu",
	"menu_api_tag",
	"menu_api_target",
];

describe("98_menu_api.c and 99_menu_context.c", () => {
	test("compile through cc() as one unit and export every symbol the adapter binds", () => {
		expect(Object.keys(menuUnit().symbols).sort()).toEqual(SYMBOLS);
	});

	test("a null sender, a targetless build and a missing window are refused, never crash", () => {
		const { symbols } = menuUnit();
		expect(Number(symbols.menu_api_tag(0))).toBe(-1);
		expect(Number(symbols.menu_api_begin())).toBe(0);
		expect(Number(symbols.menu_api_install())).toBe(0);
		expect(Number(symbols.menu_api_popup(0, 0))).toBe(0);
		expect(Number(symbols.menu_api_close())).toBe(0);
	});
});
