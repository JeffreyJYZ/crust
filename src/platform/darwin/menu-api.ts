/**
 * The macOS half of `crust:menu`: NSMenu over bun:ffi, in its own unit (`shim/98_menu_api.c` with the readback `98_menu_read.c` and the context `99_menu_context.c`) because the window shim's parts are one unit assembled in `shim-source.ts` and this one must compile alone, the way `90_clipboard.c` does. The compiler and its symbol list live in `menu-ffi.ts`.
 * **Selection.** The seam is the status item's, reused verbatim: one runtime class whose `crustMenuSelected:` IMP is the JSCallback passed to `menu_api_target`, one static target instance (because `-setTarget:` is unretained), and the row's `tag` read back in C as the index into the live id list.
 */

import { FFIType, JSCallback } from "bun:ffi";

import type { MenuAdapter, MenuItemPlan, MenuModifier } from "@/plugins/menu";
import { shim } from "./index.ts";
import { type MenuUnit, menuUnit } from "./menu-ffi.ts";
import { popContextMenu } from "./menu-context.ts";
import { isDefaultMenu, readMenu } from "./menu-readback.ts";
import { cstr } from "./objc.ts";
import { cbuf, checked } from "./status-bar-args.ts";

export { type MenuUnit, menuUnit } from "./menu-ffi.ts";

/** NSEventModifierFlags: command 1<<20, shift 1<<17, option 1<<19, control 1<<18. */
const MASK: Record<MenuModifier, number> = {
	command: 1 << 20,
	shift: 1 << 17,
	option: 1 << 19,
	control: 1 << 18,
};

function maskOf(modifiers: readonly MenuModifier[]): number {
	let mask = 0;
	for (const modifier of modifiers) mask |= MASK[modifier];
	return mask;
}

// Rows built last, indexed by the tag C reports: a click carries an index, and this
// is what turns it into the id a page hears.
let ids: string[] = [];
let route: ((id: string) => void) | undefined;

// Rows are added in the order C's stack expects: a container adds its entry, then
// descends, so `menu_api_close` pops the menu its children were added to.
function addRows(unit: MenuUnit, items: readonly MenuItemPlan[], into: string[]): void {
	for (const item of items) {
		if (item.separator) {
			checked(unit.symbols.menu_api_separator(), "separator");
			continue;
		}
		const label = cbuf(item.label);
		const key = cbuf(item.key);
		const mask = maskOf(item.modifiers);
		if (item.submenu !== undefined) {
			checked(
				unit.symbols.menu_api_submenu(label.p, label.len, key.p, key.len, mask),
				`submenu ${item.label}`,
			);
			addRows(unit, item.submenu, into);
			checked(unit.symbols.menu_api_close(), "close");
			continue;
		}
		const tag = into.length;
		into.push(item.id);
		checked(
			unit.symbols.menu_api_item(label.p, label.len, key.p, key.len, mask, tag),
			`item ${item.label}`,
		);
	}
}

// One trampoline per process: the runtime class registers one IMP, so a second
// JSCallback would never be reached. The live id list is swapped per build instead.
let callback: JSCallback | undefined;

function channel(unit: MenuUnit): number {
	if (callback === undefined) {
		callback = new JSCallback(
			(_self: number, _cmd: number, sender: number) => {
				// The sender's tag is read in C, so no Objective-C object is held here.
				const tag = Number(unit.symbols.menu_api_tag(Number(sender)) ?? -1);
				const id = tag >= 0 ? ids[tag] : undefined;
				if (id === undefined) return;
				try {
					route?.(id);
				} catch {
					// An exception crossing back into AppKit aborts the process.
				}
			},
			{ args: [FFIType.ptr, FFIType.ptr, FFIType.ptr], returns: FFIType.void },
		);
	}
	const raw: unknown = callback.ptr;
	if (typeof raw === "number") return raw;
	if (typeof raw === "bigint") return Number(raw);
	throw new Error("crust: JSCallback exposed no usable pointer");
}

/**
 * Build the menu adapter. The unit compiles on the first command, not at import, and `appName` names the bar `reset()` restores — the same name `startAppKit` installed, so pass the configured one when it is not `crust`. `read` and `isDefault` answer from the live bar, which is the only proof a rebuild landed.
 */
export function darwinMenuAdapter(options: { appName?: string } = {}): MenuAdapter {
	const appName = options.appName ?? "crust";
	const unit = menuUnit();

	/** Every build starts from an empty id list; a half-built stack is dropped by begin. */
	const build = (items: readonly MenuItemPlan[]): void => {
		ids = [];
		checked(unit.symbols.menu_api_target(channel(unit)), "menu click target");
		checked(unit.symbols.menu_api_begin(), "begin");
		addRows(unit, items, ids);
	};

	return {
		setAppMenu(items: readonly MenuItemPlan[]): void {
			build(items);
			checked(unit.symbols.menu_api_install(), "setMainMenu:");
		},
		showContext(items: readonly MenuItemPlan[], at: { x: number; y: number }): void {
			build(items);
			popContextMenu(unit, at.x, at.y);
		},
		reset(): void {
			ids = [];
			// The default bar is 55_menu.c's, so it is reused rather than rebuilt here.
			checked(shim().symbols.shim_menu_install(cstr(appName)), "restore the default menu");
		},
		read: () => readMenu(unit),
		isDefault: () => isDefaultMenu(unit, appName),
		onSelect(handler: (id: string) => void): () => void {
			route = handler;
			return () => {
				if (route === handler) route = undefined;
			};
		},
	};
}
