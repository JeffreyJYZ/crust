/**
 * `crust:tray` on Linux, through the real plugin and a fake symbol table.
 *
 * No status icon and no menu are created: that needs a desktop session and a human. What is proven is
 * the mapping — the labels C receives, the refusal `setTitle` answers, every C 0 turned into a typed
 * failure carrying the library or reason, and the click a poll hands back to the plugin's wiring.
 */
import { describe, expect, test } from "bun:test";
import { createTrayPlugin } from "@/plugins/tray";
import { recordingContext } from "@/plugins/tray-fake.ts";
import { fakeNotifyTray, type FakeNotifyTrayOptions } from "./notify-tray-fake.ts";
import { linuxTrayAdapter, TRAY_MAX_ITEMS } from "./tray-adapter.ts";

const built = (options: FakeNotifyTrayOptions = {}, calls: string[] = []) => {
	// One fake for the whole adapter: a fresh one per call would reset the click queue, which is
	// state the C keeps across calls.
	const fake = fakeNotifyTray(options, calls);
	const adapter = linuxTrayAdapter({ shim: () => fake });
	return { adapter, fake, plugin: createTrayPlugin(adapter), calls };
};

describe("tray.setTitle on Linux", () => {
	test("refuses by name and points at setTooltip", () => {
		const { plugin, calls } = built();
		expect(plugin.commands.setTitle({ text: "crust" })).toEqual({
			ok: false,
			code: "handler-error",
			message:
				'crust: tray.setTitle cannot apply "crust" — a GtkStatusIcon has no text label; ' +
				"call tray.setTooltip for the text it can show",
		});
		expect(calls).toEqual([]);
	});
});

describe("tray.setTooltip on Linux", () => {
	test("applies the text and answers what the icon now shows", () => {
		const { plugin, calls } = built();
		expect(plugin.commands.setTooltip({ text: "Build 41" })).toEqual({
			ok: true,
			text: "Build 41",
		});
		expect(calls).toContain("tooltip:Build 41");
	});

	test("a refused tooltip is a typed failure carrying C's reason", () => {
		const { plugin } = built({ tooltipResult: 0, reason: "gtk_status_icon_set_tooltip_text" });
		expect(plugin.commands.setTooltip({ text: "x" })).toEqual({
			ok: false,
			code: "handler-error",
			message: "crust: tray.setTooltip was not applied — gtk_status_icon_set_tooltip_text",
		});
	});
});

describe("tray.setMenu on Linux", () => {
	test("sends the labels one per line, in order", () => {
		const { plugin, calls } = built();
		expect(plugin.commands.setMenu({ items: [{ label: "Open" }, { label: "Quit" }] })).toEqual({
			ok: true,
			labels: ["Open", "Quit"],
		});
		expect(calls).toContain("menu:2:Open\nQuit");
	});

	test("an empty list detaches the menu rather than failing", () => {
		const { plugin, calls } = built();
		expect(plugin.commands.setMenu({ items: [] })).toEqual({ ok: true, labels: [] });
		expect(calls).toContain("menu:0:");
	});

	test("more rows than the C holds is refused, never truncated", () => {
		const { plugin, calls } = built();
		const items = Array.from({ length: TRAY_MAX_ITEMS + 1 }, (_, index) => ({
			label: `row ${index}`,
		}));
		expect(plugin.commands.setMenu({ items })).toEqual({
			ok: false,
			code: "invalid-menu",
			message: `crust: tray.setMenu accepts at most ${TRAY_MAX_ITEMS} rows on Linux, got ${TRAY_MAX_ITEMS + 1}`,
		});
		expect(calls).toEqual([]);
	});

	/**
	 * The C transport splits on `\n`. A newline inside a label used to become two rows, so clicking
	 * the second half fired the next item's handler and the last row was dropped.
	 */
	test("a label with a newline is refused before a row can split", () => {
		const { plugin, calls } = built();
		const answer = plugin.commands.setMenu({
			items: [{ label: "a\nb" }, { label: "c" }],
		});
		expect(answer).toMatchObject({ ok: false, code: "invalid-menu" });
		expect(JSON.stringify(answer)).toContain("newline");
		expect(calls).toEqual([]);
	});

	/** GTK older than 3.22 has no `gtk_menu_popup_at_pointer`, and that is the named refusal. */
	test("a menu GTK could not build names the entry point that did not resolve", () => {
		const { plugin } = built({ menuResult: 0, missing: "gtk_menu_popup_at_pointer" });
		expect(plugin.commands.setMenu({ items: [{ label: "Open" }] })).toEqual({
			ok: false,
			code: "handler-error",
			message:
				"crust: tray.setMenu was not applied — gtk_menu_popup_at_pointer did not resolve",
		});
	});
});

describe("tray.show, hide and destroy on Linux", () => {
	test("each reaches the icon and answers the item's new state", () => {
		const { plugin, calls } = built();
		expect(plugin.commands.show()).toEqual({ ok: true, active: true });
		expect(plugin.commands.hide()).toEqual({ ok: true, active: false });
		expect(plugin.commands.destroy()).toEqual({ ok: true, destroyed: true });
		expect(calls).toEqual(["show", "hide", "destroy"]);
	});

	test("a missing GTK is named on the command that needed it", () => {
		const { plugin } = built({ showResult: 0, missing: "libgtk-3.so.0" });
		expect(plugin.commands.show()).toEqual({
			ok: false,
			code: "handler-error",
			message: "crust: tray.show was not applied — libgtk-3.so.0 did not resolve",
		});
	});

	test("a unit that will not compile refuses every member by name", () => {
		const plugin = createTrayPlugin(linuxTrayAdapter({ shim: () => undefined }));
		expect(plugin.commands.show()).toEqual({
			ok: false,
			code: "handler-error",
			message: "crust: tray.show needs the notification C unit, which could not be compiled",
		});
	});
});

describe("tray clicks on Linux", () => {
	test("a polled row fires its handler and the plugin's event", () => {
		const { adapter, plugin } = built({ clicks: [1, -1] });
		const { ctx, events } = recordingContext();
		let opened = 0;
		plugin.commands.setMenu(
			{ items: [{ label: "Open", onClick: () => opened++ }, { label: "Quit" }] },
			ctx,
		);
		expect(adapter.pollClick()).toBe(1);
		expect(opened).toBe(0);
		expect(events).toEqual([["tray:click", { index: 1, label: "Quit" }]]);
		expect(adapter.pollClick()).toBe(-1);
	});

	test("an index with no row is dropped, so a stale click fires nothing", () => {
		const { adapter } = built({ clicks: [4] });
		expect(adapter.pollClick()).toBe(-1);
	});

	test("a unit that will not compile answers no click at all", () => {
		expect(linuxTrayAdapter({ shim: () => undefined }).pollClick()).toBe(-1);
	});
});
