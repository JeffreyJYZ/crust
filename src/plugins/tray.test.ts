/**
 * `crust:tray` proofs, without a menu bar.
 *
 * Two things are proven here and nothing else: the C unit compiles through
 * `cc()`, links AppKit and Foundation, and exports exactly the symbols the
 * plugin half declares; and the plugin is honest — a missing adapter says
 * `not-implemented`, a bad argument is its own typed failure, an adapter that
 * refuses is a value the page can branch on, and a click reaches both the
 * in-process handler and the `tray:click` event.
 *
 * No `NSStatusItem` is created. A live status item is a real menu-bar item and
 * needs a human to see it; the compile test above it is what runs here.
 */

import { describe, expect, test } from "bun:test";
import { STATUS_BAR_SYMBOL_NAMES, statusBar } from "@/platform/darwin/status-bar.ts";
import { isNotImplemented, type PluginContext } from "@/plugins/define";
import { PluginRegistry } from "@/plugins/registry";
import {
	createTrayPlugin,
	TRAY_COMMANDS,
	TrayAdapterError,
	type TrayMenuItem,
	type TrayNative,
	trayPlugin,
} from "@/plugins/tray";

interface FakeTray extends TrayNative {
	calls: string[];
	items: readonly TrayMenuItem[];
}

function fakeAdapter(): FakeTray {
	const adapter: FakeTray = {
		calls: [],
		items: [],
		setTitle(text) {
			adapter.calls.push(`setTitle:${text}`);
		},
		setMenu(items) {
			adapter.calls.push(`setMenu:${items.map((item) => item.label).join(",")}`);
			adapter.items = items;
		},
		show() {
			adapter.calls.push("show");
		},
		hide() {
			adapter.calls.push("hide");
		},
		destroy() {
			adapter.calls.push("destroy");
		},
	};
	return adapter;
}

function recordingContext(): { ctx: PluginContext; events: Array<[string, unknown]> } {
	const events: Array<[string, unknown]> = [];
	return {
		events,
		ctx: { emit: (event, data) => events.push([event, data]) },
	};
}

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

describe("typed failures", () => {
	test("a missing or non-string title is its own typed failure", () => {
		const plugin = createTrayPlugin(fakeAdapter());

		expect(plugin.commands.setTitle({} as { text: string })).toMatchObject({
			ok: false,
			code: "invalid-text",
		});
		expect(plugin.commands.setTitle({ text: 7 } as unknown as { text: string })).toMatchObject({
			ok: false,
			code: "invalid-text",
		});
	});

	test("a malformed menu is an invalid-menu failure at the first bad row", () => {
		const plugin = createTrayPlugin(fakeAdapter());

		expect(plugin.commands.setMenu({} as { items: [] })).toMatchObject({
			ok: false,
			code: "invalid-menu",
		});
		expect(
			plugin.commands.setMenu({ items: "nope" } as unknown as { items: [] }),
		).toMatchObject({ ok: false, code: "invalid-menu" });
		expect(plugin.commands.setMenu({ items: [{ label: "" }] })).toMatchObject({
			ok: false,
			code: "invalid-menu",
		});
		expect(plugin.commands.setMenu({ items: [{} as { label: string }] })).toMatchObject({
			ok: false,
			code: "invalid-menu",
		});
		expect(
			plugin.commands.setMenu({
				items: [{ label: "x", onClick: 7 } as unknown as TrayMenuItem],
			}),
		).toMatchObject({ ok: false, code: "invalid-menu" });
	});

	test("an adapter that throws is a typed value, not a propagated error", () => {
		const plugin = createTrayPlugin({
			setTitle: () => {
				throw new TrayAdapterError("destroyed", "status item is gone");
			},
			setMenu: () => {},
			show: () => {},
			hide: () => {},
			destroy: () => {
				throw new Error("boom");
			},
		});

		expect(plugin.commands.setTitle({ text: "x" })).toMatchObject({
			ok: false,
			code: "destroyed",
			message: "status item is gone",
		});
		expect(plugin.commands.destroy()).toMatchObject({
			ok: false,
			code: "handler-error",
			message: "boom",
		});
	});

	test("a partial adapter is an unknown-adapter failure, not a TypeError", () => {
		const plugin = createTrayPlugin({ setTitle: () => {} } as unknown as TrayNative);
		expect(plugin.commands.show()).toMatchObject({ ok: false, code: "unknown-adapter" });
		expect(plugin.commands.hide()).toMatchObject({ ok: false, code: "unknown-adapter" });
		expect(plugin.commands.setMenu({ items: [] })).toMatchObject({
			ok: false,
			code: "unknown-adapter",
		});
	});
});

describe("no adapter", () => {
	test("every command answers a structured not-implemented naming NSStatusBar", () => {
		const plugin = createTrayPlugin();
		const results = [
			plugin.commands.setTitle({ text: "x" }),
			plugin.commands.setMenu({ items: [{ label: "Open" }] }),
			plugin.commands.show(),
			plugin.commands.hide(),
			plugin.commands.destroy(),
		];

		for (const result of results) {
			expect(isNotImplemented(result)).toBe(true);
			if (isNotImplemented(result)) expect(result.requires).toBe("NSStatusBar");
		}
	});

	test("the registry turns that into a not-implemented CrustError", async () => {
		const registry = new PluginRegistry().register(createTrayPlugin());
		await expect(registry.invoke("tray", "show", {}, { emit: () => {} })).rejects.toMatchObject(
			{ code: "not-implemented", requires: "NSStatusBar" },
		);
	});
});

describe("through the registry", () => {
	test("an adapted plugin answers values a page can branch on", async () => {
		const adapter = fakeAdapter();
		const registry = new PluginRegistry().register(createTrayPlugin(adapter));
		const ctx = { emit: () => {} };

		expect(await registry.invoke("tray", "setTitle", { text: "From page" }, ctx)).toEqual({
			ok: true,
			text: "From page",
		});
		expect(await registry.invoke("tray", "show", {}, ctx)).toEqual({ ok: true, active: true });

		// A dead command on a bad argument resolves a value; only a missing
		// plugin, command or adapter is a rejection.
		expect(await registry.invoke("tray", "setTitle", { text: 1 }, ctx)).toMatchObject({
			ok: false,
			code: "invalid-text",
		});
	});
});
