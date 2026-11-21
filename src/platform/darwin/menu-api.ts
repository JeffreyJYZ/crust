/**
 * The macOS half of `crust:menu`: NSMenu over bun:ffi, in its own unit (`shim/98_menu_api.c` with the readback `98_menu_read.c` and the context `99_menu_context.c`) because the window shim's parts are one unit assembled in `shim-source.ts` and this one must compile alone, the way `90_clipboard.c` does. **Selection.** The seam is the status item's, reused verbatim: one runtime class whose `crustMenuSelected:` IMP is the JSCallback passed to `menu_api_target`, one static target instance (because `-setTarget:` is unretained), and the row's `tag` read back in C as the index into the id table the row was built for. A context menu builds a *different* table at a disjoint tag range, so popping one can never reindex the bar that is still installed.
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

/**
 * Tags are indices into a table, and an installed bar keeps its tags until it is replaced. The app
 * bar and a transient context menu therefore use disjoint ranges: a popup rewrites only its own
 * table, and the older bar's tags still resolve to the ids it was built with.
 */
export const APP_TAG_BASE = 0;
export const CONTEXT_TAG_BASE = 1 << 20;

let appIds: string[] = [];
let contextIds: string[] = [];
let route: ((id: string) => void) | undefined;

export function resolveMenuTag(tag: number): string | undefined {
	return tag >= CONTEXT_TAG_BASE
		? contextIds[tag - CONTEXT_TAG_BASE]
		: appIds[tag - APP_TAG_BASE];
}

/** Rows are added in the order C's stack expects: a container adds its entry, then descends. */
function addRows(unit: MenuUnit, items: readonly MenuItemPlan[], into: string[], base: number): void {
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
			addRows(unit, item.submenu, into, base);
			checked(unit.symbols.menu_api_close(), "close");
			continue;
		}
		into.push(item.id);
		checked(
			unit.symbols.menu_api_item(label.p, label.len, key.p, key.len, mask, base + into.length - 1),
			`item ${item.label}`,
		);
	}
}

function maskOf(modifiers: readonly MenuModifier[]): number {
	let mask = 0;
	for (const modifier of modifiers) mask |= MASK[modifier];
	return mask;
}

// One trampoline per process: the runtime class registers one IMP, so a second JSCallback would
// never be reached. The tag tells it which menu's table to read.
let callback: JSCallback | undefined;

function channel(unit: MenuUnit): number {
	if (callback === undefined) {
		callback = new JSCallback(
			(_self: number, _cmd: number, sender: number) => {
				// The sender's tag is read in C, so no Objective-C object is held here.
				const tag = Number(unit.symbols.menu_api_tag(Number(sender)) ?? -1);
				const id = tag >= 0 ? resolveMenuTag(tag) : undefined;
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
export function darwinMenuAdapter(
	options: { appName?: string; unit?: MenuUnit } = {},
): MenuAdapter {
	const appName = options.appName ?? "crust";
	const unit = options.unit ?? menuUnit();

	/** Build rows into a local table; a throw mid-build leaves the installed bar's table untouched. */
	const build = (items: readonly MenuItemPlan[], base: number): string[] => {
		checked(unit.symbols.menu_api_target(channel(unit)), "menu click target");
		checked(unit.symbols.menu_api_begin(), "begin");
		const table: string[] = [];
		addRows(unit, items, table, base);
		return table;
	};

	return {
		setAppMenu(items: readonly MenuItemPlan[]): void {
			const table = build(items, APP_TAG_BASE);
			checked(unit.symbols.menu_api_install(), "setMainMenu:");
			appIds = table;
		},
		showContext(items: readonly MenuItemPlan[], at: { x: number; y: number }): void {
			const table = build(items, CONTEXT_TAG_BASE);
			// The popup blocks inside AppKit's tracking loop and a click can fire during it, so the
			// table the new rows carry must be live before the menu is shown.
			contextIds = table;
			popContextMenu(unit, at.x, at.y);
		},
		reset(): void {
			appIds = [];
			// The default bar is 55_menu.c's, so it is reused rather than rebuilt here.
			checked(shim().symbols.shim_menu_install(cstr(appName)), "restore the default menu");
			unit.symbols.menu_api_mark_default();
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
