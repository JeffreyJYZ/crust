/**
 * `crust:menu` proofs that open no menu: every case drives a fake adapter, so nothing here builds an NSMenu, pops one, or takes focus. Refusals live in `menu-refusals.test.ts`; a context menu blocks in AppKit's tracking loop, so no test may open one.
 */

import { describe, expect, test } from "bun:test";
import { isNotImplemented, type PluginContext } from "@/plugins/define.ts";
import {
	createMenuPlugin,
	menuPlugin,
	type MenuAdapter,
	type MenuItemPlan,
} from "@/plugins/menu.ts";

interface Fake extends MenuAdapter {
	readonly apps: MenuItemPlan[][];
	readonly contexts: { items: readonly MenuItemPlan[]; x: number; y: number }[];
	readonly resets: number;
	select(id: string): void;
}

/** An adapter that records every build and can fire a selection as AppKit would. */
function fake(): Fake {
	const apps: MenuItemPlan[][] = [];
	const contexts: { items: readonly MenuItemPlan[]; x: number; y: number }[] = [];
	let resets = 0;
	let handler: ((id: string) => void) | undefined;
	return {
		apps,
		contexts,
		get resets() {
			return resets;
		},
		setAppMenu(items) {
			apps.push([...items]);
		},
		showContext(items, at) {
			contexts.push({ items: [...items], x: at.x, y: at.y });
		},
		reset() {
			resets++;
		},
		onSelect(next) {
			handler = next;
			return () => {
				handler = undefined;
			};
		},
		select(id) {
			handler?.(id);
		},
	};
}

/** A plugin context that records every event, so a selection is observable. */
function recorder(): { ctx: PluginContext; events: [string, unknown][] } {
	const events: [string, unknown][] = [];
	return { ctx: { emit: (event, data) => events.push([event, data]) }, events };
}

describe("menu plugin shape", () => {
	test("is named menu, declares three commands and is frozen", () => {
		const plugin = createMenuPlugin(fake());
		expect(plugin.name).toBe("menu");
		expect(Object.keys(plugin.commands).sort()).toEqual(["reset", "setAppMenu", "showContext"]);
		expect(Object.isFrozen(plugin)).toBe(true);
	});

	test("the default registration answers not-implemented and names NSMenu", async () => {
		expect(menuPlugin.name).toBe("menu");
		for (const command of ["setAppMenu", "showContext", "reset"] as const) {
			const answer = await menuPlugin.commands[command]({ items: [], x: 0, y: 0 });
			expect(isNotImplemented(answer)).toBe(true);
			if (isNotImplemented(answer)) expect(answer.requires).toBe("NSMenu");
		}
	});
});

describe("setAppMenu", () => {
	test("a nested spec reaches the adapter with ids and accelerators split", () => {
		const adapter = fake();
		const answer = createMenuPlugin(adapter).commands.setAppMenu({
			items: [
				{
					label: "File",
					submenu: [{ label: "Open", accelerator: "Cmd+O" }, { separator: true }],
				},
				{ label: "Quit", accelerator: "Shift+Cmd+Q" },
			],
		});

		expect(answer).toEqual({ ok: true, count: 2 });
		const built = adapter.apps[0] ?? [];
		expect(built.map((item) => item.label)).toEqual(["File", "Quit"]);
		// An id defaults to the label, so a page can listen without inventing one.
		expect(built[1]?.id).toBe("Quit");
		expect(built[0]?.submenu?.[0]).toEqual({
			label: "Open",
			id: "Open",
			key: "o",
			modifiers: ["command"],
			separator: false,
		});
		expect(built[0]?.submenu?.[1]?.separator).toBe(true);
		// Modifier order is canonical, so one accelerator has exactly one spelling.
		expect(built[1]?.modifiers).toEqual(["command", "shift"]);
	});

	test("an empty item list is a legal app menu with no rows", () => {
		const adapter = fake();
		expect(createMenuPlugin(adapter).commands.setAppMenu({ items: [] })).toEqual({
			ok: true,
			count: 0,
		});
		expect(adapter.apps).toEqual([[]]);
	});
});

describe("showContext and reset", () => {
	test("the page point reaches the adapter unchanged", () => {
		const adapter = fake();
		const answer = createMenuPlugin(adapter).commands.showContext({
			items: [{ label: "Copy" }],
			x: 12.5,
			y: 40,
		});
		expect(answer).toEqual({ ok: true, count: 1 });
		expect(adapter.contexts).toEqual([
			{
				items: [{ label: "Copy", id: "Copy", key: "", modifiers: [], separator: false }],
				x: 12.5,
				y: 40,
			},
		]);
	});

	test("reset reaches the adapter and answers a reset", () => {
		const adapter = fake();
		expect(createMenuPlugin(adapter).commands.reset()).toEqual({ ok: true, reset: true });
		expect(adapter.resets).toBe(1);
	});
});

describe("selection", () => {
	test("a chosen row is pushed as menu with its id, on the last command's context", () => {
		const adapter = fake();
		const plugin = createMenuPlugin(adapter);
		const { ctx, events } = recorder();
		plugin.commands.setAppMenu(
			{ items: [{ label: "Open", id: "file.open" }, { label: "Undo" }] },
			ctx,
		);

		adapter.select("file.open");
		adapter.select("Undo");

		expect(events).toEqual([
			["menu", { id: "file.open" }],
			["menu", { id: "Undo" }],
		]);
	});

	test("a selection before any command carries a context is dropped, never thrown", () => {
		const adapter = fake();
		createMenuPlugin(adapter);
		expect(() => adapter.select("Open")).not.toThrow();
	});
});

describe("a misbehaving adapter", () => {
	test("a throw becomes a typed handler-error", () => {
		const adapter = fake();
		adapter.setAppMenu = () => {
			throw new Error("AppKit refused setMainMenu:");
		};
		expect(createMenuPlugin(adapter).commands.setAppMenu({ items: [{ label: "A" }] })).toEqual({
			ok: false,
			code: "handler-error",
			message: "AppKit refused setMainMenu:",
		});
	});

	test("a member the adapter does not implement is named, not called", () => {
		const answer = createMenuPlugin({} as MenuAdapter).commands.setAppMenu({
			items: [{ label: "A" }],
		});
		expect(answer).toEqual({
			ok: false,
			code: "unknown-adapter",
			message: "crust: menu adapter does not implement setAppMenu",
		});
	});
});
