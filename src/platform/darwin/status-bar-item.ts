/**
 * The live status item: create, drive, route clicks, destroy. Limits enforced rather than hidden (full contract in `status-bar.ts`): one live status bar per process, because the runtime class holds a single click IMP and target so every row of every live item would share one handler set — destroying frees the slot and reuses the trampoline, so create/destroy does not allocate per cycle.
 * The click trampoline is never closed: freeing it while an AppKit menu row still points at the target is a SIGABRT with no JavaScript error, so it lives for the process.
 */

import { JSCallback } from "bun:ffi";
import { cbuf, checked, ptrValue } from "./status-bar-args";
import { PTR, statusBar, VOID } from "./status-bar-ffi";
import { readbackFrom } from "./status-bar-readback";
import type { StatusBarShim } from "./status-bar-symbols";
import type { StatusBar, StatusBarMenuItem } from "./status-bar-types";

let live: StatusBar | undefined;

/** The status item this process already has, if any. A second one cannot exist. */
export function currentStatusBar(): StatusBar | undefined {
	return live;
}

// The click trampoline is one per process: the runtime class registers one IMP,
// so a second JSCallback would never be reached. The dispatch target is swapped
// by each live status bar instead.
let clickCallback: JSCallback | undefined;
let clickRoute: ((index: number) => void) | undefined;

function clickChannel(native: StatusBarShim): JSCallback {
	if (clickCallback !== undefined) return clickCallback;
	clickCallback = new JSCallback(
		(_self: number, _cmd: number, sender: number) => {
			// The sender's `tag` is the row index this module set; reading it is a
			// C call, so no Objective-C object is held on the JavaScript side.
			const index = Number(native.symbols.tray_item_index(Number(sender)) ?? -1);
			if (index < 0) return;
			try {
				clickRoute?.(index);
			} catch {
				// An exception crossing back into AppKit aborts the process.
			}
		},
		{ args: [PTR, PTR, PTR], returns: VOID },
	);
	return clickCallback;
}

function callbackPointer(callback: JSCallback): number {
	const raw: unknown = callback.ptr;
	if (typeof raw === "number") return raw;
	if (typeof raw === "bigint") return Number(raw);
	throw new Error("crust: JSCallback exposed no usable pointer");
}

/**
 * Build a status item. Throws when another one is alive: the runtime class has
 * one click IMP and one target instance, so two live items would share a
 * handler set and clicks would fire the wrong menu's callbacks.
 */
export function createStatusBar(): StatusBar {
	if (live !== undefined) {
		throw new Error(
			"crust: one status bar per process; call destroy() on the live one before creating another",
		);
	}

	const native = statusBar();
	const imp = clickChannel(native);
	const item = ptrValue(native.symbols.tray_create(callbackPointer(imp)), "tray_create");
	if (!item) throw new Error("crust: NSStatusBar refused to create a status item");

	const capacity = Number(native.symbols.tray_title_capacity() ?? 0);
	if (capacity <= 0) throw new Error("crust: status_bar.c exposed no title buffer");

	let entries: readonly StatusBarMenuItem[] = [];
	let destroyed = false;

	const requireLive = (what: string): number => {
		if (destroyed || !item) {
			throw new Error(`crust: status bar was destroyed; ${what} needs a live item`);
		}
		return item;
	};

	const bar: StatusBar = {
		setTitle(text: string): void {
			const target = requireLive("setTitle");
			const { p, len } = cbuf(text);
			checked(native.symbols.tray_set_title(target, p, len), "setTitle");
			const applied = String(native.symbols.tray_title_copy(target) ?? "");
			if (len <= capacity - 1 && applied !== text) {
				throw new Error(`crust: status title applied as ${JSON.stringify(applied)}`);
			}
		},

		show(): void {
			checked(native.symbols.tray_set_visible(requireLive("show"), 1), "show");
		},

		hide(): void {
			checked(native.symbols.tray_set_visible(requireLive("hide"), 0), "hide");
		},

		setMenu(items: readonly StatusBarMenuItem[]): void {
			const target = requireLive("setMenu");
			// Copy first: a caller mutating its array must not change what a click
			// dispatches to.
			const next = items.map((entry) => ({ label: entry.label, onClick: entry.onClick }));

			if (next.length === 0) {
				checked(native.symbols.tray_menu_clear(target), "setMenu (clear)");
				entries = [];
				return;
			}

			checked(native.symbols.tray_menu_begin(target), "setMenu (begin)");
			for (let index = 0; index < next.length; index++) {
				const entry = next[index];
				if (entry === undefined) continue;
				const { p, len } = cbuf(entry.label);
				checked(native.symbols.tray_menu_add(p, len, index), `setMenu (row ${index})`);
			}
			checked(native.symbols.tray_menu_end(target), "setMenu (end)");
			entries = next;
		},

		destroy(): void {
			if (destroyed) return;
			destroyed = true;
			entries = [];
			clickRoute = undefined;
			native.symbols.tray_destroy(item);
			live = undefined;
		},

		activateRow(index: number): boolean {
			const target = requireLive("activateRow");
			const count = Number(native.symbols.tray_menu_count(target) ?? -1);
			if (!Number.isInteger(index) || index < 0 || index >= count) return false;
			return Number(native.symbols.tray_menu_activate(target, index) ?? 0) === 1;
		},

		readback() {
			return readbackFrom(native, requireLive("readback"));
		},
	};

	clickRoute = (index: number) => {
		const entry = entries[index];
		if (entry === undefined) return;
		entry.onClick?.();
	};

	live = bar;
	return bar;
}
