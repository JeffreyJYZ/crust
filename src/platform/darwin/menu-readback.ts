/**
 * Readback for `crust:menu`: `-[NSApp mainMenu]` walked in C, handed over as flat rows and rebuilt into a tree here. Every field is what AppKit holds right now, so a caller sees what a rebuild actually installed rather than the spec that asked for it — and no menu is opened, so a test can assert it.
 */

import { menuTree, type MenuReadItem, type MenuReadRow } from "@/plugins/menu";
import type { MenuUnit } from "./menu-ffi.ts";
import { cbuf } from "./status-bar-args.ts";

/** A `BOOL` selector's answer: `-1` from C means this AppKit has no such selector. */
function flag(value: unknown): boolean {
	return Number(value ?? -1) === 1;
}

/** Every row of the live main menu, root rows first and each root's children after it. */
export function readMenuRows(unit: MenuUnit): MenuReadRow[] {
	const count = Number(unit.symbols.menu_api_read() ?? -1);
	if (count <= 0) return [];
	const rows: MenuReadRow[] = [];
	for (let index = 0; index < count; index++) {
		rows.push({
			parent: Number(unit.symbols.menu_api_read_parent(index) ?? -2),
			title: String(unit.symbols.menu_api_read_title(index) ?? ""),
			enabled: flag(unit.symbols.menu_api_read_enabled(index)),
			hasSubmenu: flag(unit.symbols.menu_api_read_has_submenu(index)),
			keyEquivalent: String(unit.symbols.menu_api_read_key(index) ?? ""),
			modifierMask: Number(unit.symbols.menu_api_read_mask(index) ?? -1),
		});
	}
	return rows;
}

/** The live menu as a tree. An empty array means AppKit holds no main menu. */
export function readMenu(unit: MenuUnit): MenuReadItem[] {
	return menuTree(readMenuRows(unit));
}

/** Is the bar the one crust installed for `appName`, rather than one a caller built? */
export function isDefaultMenu(unit: MenuUnit, appName: string): boolean {
	const name = cbuf(appName);
	return Number(unit.symbols.menu_api_is_default(name.p, name.len) ?? 0) === 1;
}
