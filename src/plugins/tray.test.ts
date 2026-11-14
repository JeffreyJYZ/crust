/**
 * `crust:tray` proofs, without a menu bar.
 *
 * Two things are proven here and nothing else: the C unit compiles through
 * `cc()`, links AppKit and Foundation, and exports exactly the symbols the
 * plugin half declares; and the plugin's five commands reach an adapter and
 * relay every click. The refusal side is `tray-failures.test.ts`.
 *
 * No `NSStatusItem` is created. A live status item is a real menu-bar item and
 * needs a human to see it; the compile test above it is what runs here.
 */

import { describe, expect, test } from "bun:test";
import { STATUS_BAR_SYMBOL_NAMES, statusBar } from "@/platform/darwin/status-bar.ts";
import { fakeAdapter, recordingContext } from "./tray-fake.ts";
import { createTrayPlugin, TRAY_COMMANDS, trayPlugin } from "./tray.ts";

describe("status_bar.c", () => {
	test("compiles through cc() and links AppKit", () => {
		const compiled = statusBar();
		// A C call round-trips: tray_abi is a constant, and the title buffer is a
		// real allocation in C, so both prove the unit actually linked and ran.
		expect(Number(compiled.symbols.tray_abi())).toBe(1);
		expect(Number(compiled.symbols.tray_title_capacity())).toBeGreaterThan(0);
	});

	test("exports exactly the declared symbols", () => {
		const compiled = statusBar();
		for (const name of STATUS_BAR_SYMBOL_NAMES) {
			expect(typeof compiled.symbols[name]).toBe("function");
		}
		expect(Object.keys(compiled.symbols).sort()).toEqual([...STATUS_BAR_SYMBOL_NAMES].sort());
	});

	test("the click and title accessors refuse a null receiver, never crash", () => {
		const compiled = statusBar();
		expect(Number(compiled.symbols.tray_item_index(0))).toBe(-1);
		expect(String(compiled.symbols.tray_title_copy(0))).toBe("");
		expect(Number(compiled.symbols.tray_menu_count(0))).toBe(-1);
		expect(Number(compiled.symbols.tray_set_title(0, 0, 0))).toBe(0);
		expect(Number(compiled.symbols.tray_set_visible(0, 1))).toBe(0);
	});
});

describe("tray plugin shape", () => {
	test("is named tray and declares exactly the five commands", () => {
		const plugin = createTrayPlugin(fakeAdapter());
		expect(plugin.name).toBe("tray");
		expect(Object.keys(plugin.commands).sort()).toEqual([...TRAY_COMMANDS].sort());
		expect(Object.isFrozen(plugin)).toBe(true);
	});

	test("the default export is the adapter-less one", () => {
		expect(trayPlugin.name).toBe("tray");
		expect(Object.keys(trayPlugin.commands).sort()).toEqual([...TRAY_COMMANDS].sort());
	});
});

describe("tray commands with an adapter", () => {
	test("setTitle, setMenu, show, hide and destroy reach the adapter", () => {
		const adapter = fakeAdapter();
		const plugin = createTrayPlugin(adapter);

		expect(plugin.commands.setTitle({ text: "crust" })).toEqual({ ok: true, text: "crust" });
		expect(plugin.commands.setMenu({ items: [{ label: "Open" }, { label: "Quit" }] })).toEqual({
			ok: true,
			labels: ["Open", "Quit"],
		});
		expect(plugin.commands.show()).toEqual({ ok: true, active: true });
		expect(plugin.commands.hide()).toEqual({ ok: true, active: false });
		expect(plugin.commands.destroy()).toEqual({ ok: true, destroyed: true });

		expect(adapter.calls).toEqual([
			"setTitle:crust",
			"setMenu:Open,Quit",
			"show",
			"hide",
			"destroy",
		]);
	});

	test("an empty menu detaches, and the answer still names no rows", () => {
		const adapter = fakeAdapter();
		const plugin = createTrayPlugin(adapter);
		expect(plugin.commands.setMenu({ items: [] })).toEqual({ ok: true, labels: [] });
		expect(adapter.calls).toEqual(["setMenu:"]);
	});

	test("a click reaches the in-process handler and pushes tray:click", () => {
		const adapter = fakeAdapter();
		const plugin = createTrayPlugin(adapter);
		const { ctx, events } = recordingContext();
		const clicked: string[] = [];

		plugin.commands.setMenu(
			{
				items: [{ label: "Open", onClick: () => clicked.push("open") }, { label: "Quit" }],
			},
			ctx,
		);

		adapter.items[0]?.onClick?.();
		adapter.items[1]?.onClick?.();

		expect(clicked).toEqual(["open"]);
		expect(events).toEqual([
			["tray:click", { index: 0, label: "Open" }],
			["tray:click", { index: 1, label: "Quit" }],
		]);
	});

	test("a throwing click handler is contained, and the event still fires", () => {
		const adapter = fakeAdapter();
		const plugin = createTrayPlugin(adapter);
		const { ctx, events } = recordingContext();

		plugin.commands.setMenu(
			{
				items: [
					{
						label: "Boom",
						onClick: () => {
							throw new Error("handler exploded");
						},
					},
				],
			},
			ctx,
		);

		expect(() => adapter.items[0]?.onClick?.()).not.toThrow();
		expect(events).toEqual([["tray:click", { index: 0, label: "Boom" }]]);
	});
});
