/**
 * The menu bar is where ⌘Q, ⌘C and ⌘V come from: AppKit dispatches each key
 * equivalent through its menu item's action, so an app with no `mainMenu` has no
 * shortcut at all. Nothing here shows a window — `NSMenu` construction needs none,
 * and the reads answer from the installed object — so the suite stays off the screen.
 */
import { describe, expect, test } from "bun:test";
import { ptr } from "bun:ffi";
import { shim } from "./index.ts";

/** A `const char *` argument, since a JS string cannot cross into C. */
function cstr(s: string): number {
	const bytes = new TextEncoder().encode(`${s}\0`);
	return ptr(bytes);
}

/** Whether a shortcut pair is on some submenu of the installed main menu. */
function has(action: string, key: string): number {
	return Number(shim().symbols.shim_menu_has(cstr(action), cstr(key)) ?? -1);
}

describe("main menu", () => {
	test("a fresh process has no main menu, so no shortcut", () => {
		// Nothing in this suite starts AppKit, so the readback must be honestly
		// empty before the install — a readback that reports 1 regardless proves
		// nothing about the menu.
		expect(Number(shim().symbols.shim_menu_ready() ?? -1)).toBe(0);
		expect(has("terminate:", "q")).toBe(0);
	});

	test("install puts Quit, Copy and Paste on the menu bar", () => {
		const installed = Number(shim().symbols.shim_menu_install(cstr("crust menu test")) ?? 0);
		expect(installed).toBe(1);

		// The app menu's Quit item — the one guaranteed item — with ⌘Q.
		expect(has("terminate:", "q")).toBe(1);
		// The Edit menu, which is what makes ⌘C and ⌘V reach the focused webview.
		expect(has("copy:", "c")).toBe(1);
		expect(has("paste:", "v")).toBe(1);
		// The rest of the Edit menu, since a menu with a hole in it reads as a bug.
		expect(has("undo:", "z")).toBe(1);
		expect(has("redo:", "Z")).toBe(1);
		expect(has("cut:", "x")).toBe(1);
		expect(has("selectAll:", "a")).toBe(1);

		expect(Number(shim().symbols.shim_menu_ready() ?? -1)).toBe(1);
	});

	test("an empty app name is refused and leaves the installed menu alone", () => {
		expect(Number(shim().symbols.shim_menu_install(cstr("")) ?? -1)).toBe(0);
		expect(Number(shim().symbols.shim_menu_ready() ?? -1)).toBe(1);
	});

	/**
	 * A shortcut that is not on the menu is exactly what a missing Edit menu looks
	 * like, so an unknown pair must answer 0 rather than any found item's answer.
	 */
	test("a pair that is not on the menu reads 0", () => {
		expect(has("copy:", "v")).toBe(0);
		expect(has("terminate:", "w")).toBe(0);
	});
});
