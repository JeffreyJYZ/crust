/**
 * A click carries a numeric tag, not an id. The regression this file pins is the one a popup used to
 * cause: building a context menu reassigned the single id table, so a click on the still-installed
 * app bar resolved against the popup's rows and ran the wrong command. No AppKit menu is opened — the
 * adapter's native unit is faked and only the table the trampoline reads is asserted.
 */
import { describe, expect, test } from "bun:test";
import type { MenuItemPlan } from "@/plugins/menu";
import {
	APP_TAG_BASE,
	CONTEXT_TAG_BASE,
	darwinMenuAdapter,
	resolveMenuTag,
	type MenuUnit,
} from "./menu-api.ts";

/** A unit that records the tags it hands to C, so the test reads the same numbers a click does. */
function unit(failTag?: number): MenuUnit & { tags: number[] } {
	const tags: number[] = [];
	const ok = () => 1;
	const symbol = () => ok;
	const symbols = {
		menu_api_target: symbol(),
		menu_api_begin: symbol(),
		menu_api_item: (_l: number, _ln: number, _k: number, _kn: number, _m: number, tag: number) => {
			if (failTag !== undefined && tag === failTag) throw new Error("C refused");
			tags.push(tag);
			return 1;
		},
		menu_api_submenu: symbol(),
		menu_api_separator: symbol(),
		menu_api_close: symbol(),
		menu_api_install: symbol(),
		menu_api_popup: symbol(),
		menu_api_tag: (sender: number) => sender,
		menu_api_read: symbol(),
		menu_api_read_parent: symbol(),
		menu_api_read_enabled: symbol(),
		menu_api_read_has_submenu: symbol(),
		menu_api_read_mask: symbol(),
		menu_api_read_title: () => "",
		menu_api_read_key: () => "",
		menu_api_is_default: symbol(),
		menu_api_mark_default: () => {},
	};
	return { symbols, tags };
}

const row = (id: string): MenuItemPlan => ({
	label: id,
	id,
	key: "",
	modifiers: [],
	separator: false,
});

describe("menu id tables", () => {
	test("app and context rows use disjoint tag ranges", () => {
		const native = unit();
		const adapter = darwinMenuAdapter({ unit: native });
		adapter.setAppMenu([row("save"), row("quit")]);
		expect(native.tags).toEqual([APP_TAG_BASE, APP_TAG_BASE + 1]);
		adapter.showContext([row("copy")], { x: 0, y: 0 });
		expect(native.tags.at(-1)).toBe(CONTEXT_TAG_BASE);
	});

	test("popping a context menu cannot reindex the app bar still on screen", () => {
		const native = unit();
		const adapter = darwinMenuAdapter({ unit: native });
		adapter.setAppMenu([row("save"), row("quit")]);
		const [save, quit] = native.tags;
		adapter.showContext([row("copy")], { x: 0, y: 0 });
		expect(resolveMenuTag(save as number)).toBe("save");
		expect(resolveMenuTag(quit as number)).toBe("quit");
		expect(resolveMenuTag(CONTEXT_TAG_BASE)).toBe("copy");
	});

	test("a failed rebuild leaves the installed bar's table intact", () => {
		const native = unit();
		const adapter = darwinMenuAdapter({ unit: native });
		adapter.setAppMenu([row("save")]);
		const before = resolveMenuTag(APP_TAG_BASE);
		const failing = unit(APP_TAG_BASE + 1);
		const broken = darwinMenuAdapter({ unit: failing });
		expect(() => broken.setAppMenu([row("first"), row("boom")])).toThrow("C refused");
		expect(resolveMenuTag(APP_TAG_BASE)).toBe(before);
	});

	test("an unknown tag answers nothing instead of firing another row's command", () => {
		expect(resolveMenuTag(-1)).toBeUndefined();
		expect(resolveMenuTag(CONTEXT_TAG_BASE + 99)).toBeUndefined();
	});
});
