/**
 * The runtime proof `crust:menu` needs: build a bar with the real adapter, then read `-[NSApp mainMenu]` back through the C unit. Nothing here opens a menu — no popup, no tracking loop, no window — so the suite can assert what AppKit holds instead of trusting the spec that asked for it.
 */

import { describe, expect, test } from "bun:test";
import type { MenuItemPlan } from "@/plugins/menu.ts";
import { darwinMenuAdapter } from "./menu-api.ts";

/** A leaf row, spelled out because the plan is the plugin's own shape. */
function leaf(label: string, key = "", command = false): MenuItemPlan {
	return {
		label,
		id: label,
		key,
		modifiers: command ? ["command"] : [],
		separator: false,
	};
}

describe("the live main menu", () => {
	test("what setAppMenu built is what AppKit holds, submenu and accelerator included", () => {
		const adapter = darwinMenuAdapter();
		adapter.setAppMenu([
			{
				...leaf("File"),
				submenu: [leaf("Open", "o", true), { ...leaf(""), separator: true }],
			},
			leaf("Quit", "q", true),
		]);

		const items = adapter.read?.() ?? [];
		expect(items.map((item) => item.title)).toEqual(["File", "Quit"]);
		expect(items[0]?.hasSubmenu).toBe(true);
		expect(items[0]?.children?.map((item) => item.title)).toEqual(["Open", ""]);
		expect(items[0]?.children?.[0]?.keyEquivalent).toBe("o");
		expect(items[0]?.children?.[0]?.modifierMask).toBe(1 << 20);
		expect(items[0]?.children?.[0]?.enabled).toBe(true);
		expect(items[1]?.keyEquivalent).toBe("q");
	});

	test("a row built without an accelerator reads AppKit's default mask, not the plan", () => {
		const adapter = darwinMenuAdapter();
		adapter.setAppMenu([leaf("Plain")]);

		const [item] = adapter.read?.() ?? [];
		expect(item?.title).toBe("Plain");
		expect(item?.keyEquivalent).toBe("");
		// The plan asked for no modifier; AppKit stores Command for every new row,
		// which is only visible to a readback of the live menu.
		expect(item?.modifierMask).toBe(1 << 20);
	});

	test("isDefault tells the bar crust installed from one a caller built", () => {
		const adapter = darwinMenuAdapter();
		adapter.setAppMenu([leaf("Only")]);
		expect(adapter.isDefault?.()).toBe(false);

		adapter.reset();
		expect(adapter.isDefault?.()).toBe(true);
		const items = adapter.read?.() ?? [];
		expect(items.map((item) => item.title)).toEqual(["crust", "Edit"]);
		// ⌘C lives on an Edit row, so the readback sees the default bar's contents.
		expect(items[1]?.children?.map((item) => item.keyEquivalent)).toContain("c");
	});

	test("a bar of one entry is never the default, whatever it is titled", () => {
		const adapter = darwinMenuAdapter();
		adapter.setAppMenu([leaf("crust")]);
		expect(adapter.isDefault?.()).toBe(false);
	});
});
