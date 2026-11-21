/**
 * `menu.isDefault` used to infer identity from "two roots, first titled after the app", so a page
 * that rebuilt the bar with that shape — and removed ⌘C/⌘V/⌘Q — could answer true. The C unit now
 * records the pointer of the bar crust installed and compares identity; this pins both halves.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (file: string): string => readFileSync(join(import.meta.dir, file), "utf8");

describe("isDefault identity", () => {
	test("the C readback compares the live menu's pointer, not its shape", () => {
		const source = read("shim/98_menu_read.c");
		const body = source.slice(source.indexOf("int menu_api_is_default("));
		expect(body).toContain("main_menu == menu_default_bar");
		expect(body).not.toContain("menu_read_total(main_menu) != 2");
	});

	test("the default bar is marked at startup and after reset, never by a context popup", () => {
		const appkit = read("appkit.ts");
		const adapter = read("menu-api.ts");
		expect(appkit).toContain("menuUnit().symbols.menu_api_mark_default()");
		expect(adapter).toContain("unit.symbols.menu_api_mark_default()");
		const showContext = adapter.slice(adapter.indexOf("showContext("), adapter.indexOf("reset("));
		expect(showContext).not.toContain("menu_api_mark_default");
	});
});
