/**
 * `crust:menu`'s refusals: the spec grammar, the accelerator grammar and the context point, each a typed value rather than a throw across the bridge. The adapter here is inert — nothing is built, so no menu exists to open.
 */

import { describe, expect, test } from "bun:test";
import { isNotImplemented } from "@/plugins/define.ts";
import { createMenuPlugin, type MenuAdapter } from "@/plugins/menu.ts";

/** An adapter that accepts everything: these cases never reach it. */
const quiet = (): MenuAdapter => ({
	setAppMenu: () => {},
	showContext: () => {},
	reset: () => {},
	onSelect: () => () => {},
});

describe("item specs", () => {
	test("a duplicate id is refused, because a click could not say which row it was", () => {
		const answer = createMenuPlugin(quiet()).commands.setAppMenu({
			items: [{ label: "Open" }, { label: "Open", id: "Open" }],
		});
		expect(answer).toEqual({
			ok: false,
			code: "bad-items",
			message:
				'menu: setAppMenu.items[1].id "Open" is used twice, so a selection could not say which row it was',
		});
	});

	test("a non-array, a non-object, a blank label and a non-array submenu are refused", () => {
		const plugin = createMenuPlugin(quiet());
		const cases: [unknown, string][] = [
			[{ items: {} }, "menu.setAppMenu needs { items } with an array"],
			[{ items: [5] }, "menu: setAppMenu.items[0] must be an object"],
			[{ items: [{ label: "" }] }, "menu: setAppMenu.items[0] needs a non-empty label"],
			[
				{ items: [{ label: "A", submenu: "B" }] },
				"menu: setAppMenu.items[0].submenu must be an array",
			],
		];
		for (const [payload, message] of cases) {
			expect(plugin.commands.setAppMenu(payload)).toEqual({
				ok: false,
				code: "bad-items",
				message,
			});
		}
	});

	test("a separator cannot carry a submenu, and a blank id is refused", () => {
		const plugin = createMenuPlugin(quiet());
		expect(plugin.commands.setAppMenu({ items: [{ separator: true, submenu: [] }] })).toEqual({
			ok: false,
			code: "bad-items",
			message: "menu: setAppMenu.items[0] is a separator and cannot carry a submenu",
		});
		expect(plugin.commands.setAppMenu({ items: [{ label: "A", id: "" }] })).toEqual({
			ok: false,
			code: "bad-items",
			message: "menu: setAppMenu.items[0].id must be a non-empty string when given",
		});
	});
});

describe("accelerators", () => {
	test("only Cmd, Ctrl, Alt and Shift with one printable key are accepted", () => {
		const plugin = createMenuPlugin(quiet());
		const refusals: [string, string][] = [
			["CommandOrControl+K", "CommandOrControl"],
			["Meta+K", "Meta"],
			["K", "K"],
			["Cmd+K+J", "K"],
			["Cmd+Cmd+K", "Cmd"],
			["Cmd+Return", "Return"],
			["", "accelerator"],
		];
		for (const [accelerator, part] of refusals) {
			const answer = plugin.commands.setAppMenu({ items: [{ label: "X", accelerator }] });
			if (isNotImplemented(answer)) throw new Error("adapter went missing");
			expect(answer.ok).toBe(false);
			if (answer.ok) continue;
			expect(answer.code).toBe("bad-accelerator");
			expect(answer.part).toBe(part);
		}
	});

	test("a non-string accelerator is refused before any parsing", () => {
		const answer = createMenuPlugin(quiet()).commands.setAppMenu({
			items: [{ label: "X", accelerator: 3 as unknown as string }],
		});
		expect(answer).toEqual({
			ok: false,
			code: "bad-accelerator",
			message: "menu: setAppMenu.items[0].accelerator must be a string",
			part: "accelerator",
		});
	});
});

describe("the context point", () => {
	test("a missing, non-numeric or infinite point is refused", () => {
		const plugin = createMenuPlugin(quiet());
		const items = [{ label: "Copy" }];
		const payloads: unknown[] = [
			{ items },
			{ items, x: "1", y: 2 },
			{ items, x: 1, y: Number.POSITIVE_INFINITY },
		];
		for (const payload of payloads) {
			expect(plugin.commands.showContext(payload)).toEqual({
				ok: false,
				code: "bad-coordinates",
				message: "menu.showContext needs { x, y } with finite numbers, in page pixels",
			});
		}
	});
});
