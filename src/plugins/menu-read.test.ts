/**
 * `crust:menu`'s readback, without a menu: the tree assembly over rows a platform would hand over, and the two commands that relay an adapter's answer. The native readback is `src/platform/darwin/menu-readback.test.ts`; nothing here builds or opens an NSMenu.
 */

import { describe, expect, test } from "bun:test";
import { isNotImplemented } from "@/plugins/define.ts";
import { createMenuPlugin, menuTree, type MenuAdapter, type MenuReadRow } from "@/plugins/menu.ts";

/** A row with every field defaulted, so a case names only what it asserts. */
function row(over: Partial<MenuReadRow> = {}): MenuReadRow {
	return {
		parent: -1,
		title: "Row",
		enabled: true,
		hasSubmenu: false,
		keyEquivalent: "",
		modifierMask: 1 << 20,
		...over,
	};
}

const quiet = (over: Partial<MenuAdapter> = {}): MenuAdapter => ({
	setAppMenu: () => {},
	showContext: () => {},
	reset: () => {},
	onSelect: () => () => {},
	...over,
});

describe("menuTree", () => {
	test("rows with no parent are the bar, and a child lands in the row before it", () => {
		const tree = menuTree([
			row({ title: "File", hasSubmenu: true }),
			row({ parent: 0, title: "Open", keyEquivalent: "o" }),
			row({ title: "Quit", keyEquivalent: "q" }),
		]);
		expect(tree.map((item) => item.title)).toEqual(["File", "Quit"]);
		expect(tree[0]?.children?.map((item) => item.title)).toEqual(["Open"]);
		// `children` is present only where a submenu is, so a leaf reads as one object.
		expect(tree[1] === undefined ? undefined : "children" in tree[1]).toBe(false);
	});

	test("an empty read is an empty bar, and a parent out of range is kept at the bar", () => {
		expect(menuTree([])).toEqual([]);
		const tree = menuTree([row({ title: "Orphan", parent: 7 })]);
		expect(tree.map((item) => item.title)).toEqual(["Orphan"]);
	});

	test("every field is carried through, including a mask the spec never asked for", () => {
		const [item] = menuTree([row({ title: "Paste", enabled: false, modifierMask: 1 << 20 })]);
		expect(item).toEqual({
			title: "Paste",
			enabled: false,
			hasSubmenu: false,
			keyEquivalent: "",
			modifierMask: 1 << 20,
		});
	});
});

describe("read and isDefault", () => {
	test("read relays the adapter's live items verbatim", () => {
		const items = menuTree([row({ title: "Edit" })]);
		const plugin = createMenuPlugin(quiet({ read: () => items }));
		expect(plugin.commands.read()).toEqual({ ok: true, items });
	});

	test("isDefault relays the adapter's verdict", () => {
		expect(createMenuPlugin(quiet({ isDefault: () => true })).commands.isDefault()).toEqual({
			ok: true,
			isDefault: true,
		});
	});

	test("an adapter that cannot read is named, and the command is never invented", () => {
		const plugin = createMenuPlugin(quiet());
		for (const command of ["read", "isDefault"] as const) {
			expect(plugin.commands[command]()).toEqual({
				ok: false,
				code: "unknown-adapter",
				message: `crust: menu adapter does not implement ${command}`,
			});
		}
	});

	test("a read that throws becomes a typed handler-error", () => {
		const plugin = createMenuPlugin(
			quiet({
				read: () => {
					throw new Error("no main menu");
				},
			}),
		);
		expect(plugin.commands.read()).toEqual({
			ok: false,
			code: "handler-error",
			message: "no main menu",
		});
	});

	test("the default registration answers not-implemented for both", () => {
		for (const command of ["read", "isDefault"] as const) {
			const answer = createMenuPlugin().commands[command]();
			expect(isNotImplemented(answer)).toBe(true);
			if (isNotImplemented(answer)) expect(answer.requires).toBe("NSMenu");
		}
	});
});
