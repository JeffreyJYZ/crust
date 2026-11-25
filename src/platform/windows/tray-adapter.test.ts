/**
 * `crust:tray` on Windows, through the real plugin and a fake symbol table.
 *
 * No icon is created and no menu is shown: that needs a notification area and a human. What is
 * proven is the mapping — the labels C receives, the refusal `setTitle` answers, every C 0 turned
 * into a typed failure carrying the reason, and the click a poll hands back to the plugin's own
 * wiring.
 */
import { describe, expect, test } from "bun:test";
import { createTrayPlugin } from "@/plugins/tray";
import { recordingContext } from "@/plugins/tray-fake.ts";
import { fakeNotifyTray } from "./notify-tray-fake.ts";
import { TRAY_MAX_ITEMS, windowsTrayAdapter } from "./tray-adapter.ts";

const built = (options: Parameters<typeof fakeNotifyTray>[0] = {}, calls: string[] = []) => {
	// One fake for the whole adapter: a fresh one per call would reset the click queue, which is
	// state the C keeps across calls.
	const fake = fakeNotifyTray(options, calls);
	const adapter = windowsTrayAdapter({ shim: () => fake });
	return { adapter, fake, plugin: createTrayPlugin(adapter), calls };
};

describe("tray.setTitle on Windows", () => {
	/**
	 * A notification-area icon has no text label. Answering `{ ok: true, text }` would claim a label
	 * nobody can see, so the refusal names the member that does carry text.
	 */
	test("refuses by name and points at setTooltip", () => {
		const { plugin, calls } = built();
		const result = plugin.commands.setTitle({ text: "crust" });
		expect(result).toEqual({
			ok: false,
			code: "handler-error",
			message:
				'crust: tray.setTitle cannot apply "crust" — a Windows notification-area icon has no ' +
				"text label; call tray.setTooltip for the text it can show",
		});
		expect(calls).toEqual([]);
	});
});

describe("tray.setTooltip on Windows", () => {
	test("applies the text and answers what the item now shows", () => {
		const { plugin, calls } = built();
		expect(plugin.commands.setTooltip({ text: "Build 41" })).toEqual({
			ok: true,
			text: "Build 41",
		});
		expect(calls).toContain("tooltip:Build 41");
	});

	test("a refused tooltip is a typed failure carrying C's reason", () => {
		const { plugin } = built({
			tooltipResult: 0,
			reason: "Shell_NotifyIconW(NIM_MODIFY, NIF_TIP) returned FALSE",
		});
		expect(plugin.commands.setTooltip({ text: "x" })).toEqual({
			ok: false,
			code: "handler-error",
			message:
				"crust: tray.setTooltip was not applied — " +
				"Shell_NotifyIconW(NIM_MODIFY, NIF_TIP) returned FALSE",
		});
	});
});

describe("tray.setMenu on Windows", () => {
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

	/** Past the C's table the rows would be dropped in silence, which is the failure to refuse. */
	test("more rows than the C holds is refused, never truncated", () => {
		const { plugin, calls } = built();
		const items = Array.from({ length: TRAY_MAX_ITEMS + 1 }, (_, index) => ({
			label: `row ${index}`,
		}));
		expect(plugin.commands.setMenu({ items })).toEqual({
			ok: false,
			code: "invalid-menu",
			message: `crust: tray.setMenu accepts at most ${TRAY_MAX_ITEMS} rows on Windows, got ${TRAY_MAX_ITEMS + 1}`,
		});
		expect(calls).toEqual([]);
	});

	/** C splits the joined buffer on every newline and ignores the row count, so `a\nb` is two rows. */
	test("a newline inside a label is refused before any row is sent", () => {
		const { plugin, calls } = built();
		expect(
			plugin.commands.setMenu({
				items: [{ label: "a\nb" }, { label: "Quit" }],
			}),
		).toEqual({
			ok: false,
			code: "invalid-menu",
			message:
				"crust: tray.setMenu item 0 contains a newline; the Windows menu transport " +
				"uses \\n to separate rows and cannot carry one inside a label",
		});
		expect(calls).toEqual([]);
	});

	test("a menu C could not store names the entry point that did not resolve", () => {
		const { plugin } = built({ menuResult: 0, missing: "TrackPopupMenu" });
		const result = plugin.commands.setMenu({ items: [{ label: "Open" }] });
		expect(result).toEqual({
			ok: false,
			code: "handler-error",
			message: "crust: tray.setMenu was not applied — TrackPopupMenu did not resolve",
		});
	});
});

describe("tray.show, hide and destroy on Windows", () => {
	test("each reaches the icon and answers the item's new state", () => {
		const { plugin, calls } = built();
		expect(plugin.commands.show()).toEqual({ ok: true, active: true });
		expect(plugin.commands.hide()).toEqual({ ok: true, active: false });
		expect(plugin.commands.destroy()).toEqual({ ok: true, destroyed: true });
		expect(calls).toEqual(["show", "hide", "destroy"]);
	});

	test("a refused hide keeps the item and says so", () => {
		const { plugin } = built({
			hideResult: 0,
			reason: "Shell_NotifyIconW(NIM_DELETE) returned FALSE",
		});
		expect(plugin.commands.hide()).toEqual({
			ok: false,
			code: "handler-error",
			message:
				"crust: tray.hide was not applied — Shell_NotifyIconW(NIM_DELETE) returned FALSE",
		});
	});

	test("a unit that will not compile refuses every member by name", () => {
		const plugin = createTrayPlugin(windowsTrayAdapter({ shim: () => undefined }));
		expect(plugin.commands.show()).toEqual({
			ok: false,
			code: "handler-error",
			message: "crust: tray.show needs the notification C unit, which could not be compiled",
		});
	});
});

describe("tray clicks on Windows", () => {
	/**
	 * The C records the chosen row and the adapter polls it, because a Win32 message is not a
	 * JavaScript call. The plugin's own wiring is what turns it into `tray:click`.
	 */
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
		expect(windowsTrayAdapter({ shim: () => undefined }).pollClick()).toBe(-1);
	});
});
