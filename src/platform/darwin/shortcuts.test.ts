/**
 * The Carbon half of `crust:shortcut`, driven without the keyboard: `dispatch` builds the event a press would have carried and sends it to the application event target, so the installed handler runs exactly as on a press. No `CGEventPost`, no HID post, no cursor, no accessibility grant.
 * It cannot prove macOS would route a real key press to the hot key — that needs a person and a key — so that stays stated in the report rather than faked.
 */

import { describe, expect, test } from "bun:test";
import type { PluginContext } from "@/plugins/define.ts";
import { createShortcutsPlugin } from "@/plugins/shortcuts.ts";
import { darwinShortcutsAdapter, shortcutUnit, shortcutUnitStatus } from "./shortcuts.ts";

const skip = process.platform !== "darwin";

describe("shortcut C unit", () => {
	test.skipIf(skip)("compiles and links Carbon through cc()", () => {
		expect(shortcutUnitStatus()).toEqual({ available: true, reason: "compiled" });
	});

	test.skipIf(skip)("resolves every Carbon call the dispatch path makes", () => {
		// 31 = CreateEvent, SetEventParameter, GetEventParameter, SendEventToEventTarget
		// and GetApplicationEventTarget. A symbol the loader never resolved faults on
		// the first real press, so the bitmask reads each one back instead.
		expect(Number(shortcutUnit().symbols.shortcut_event_abi())).toBe(31);
	});

	test.skipIf(skip)("dispatch refuses an accelerator this process never registered", () => {
		expect(darwinShortcutsAdapter().dispatch("command+shift+k")).toBe(false);
	});
});

describe("a hot key fired without the keyboard", () => {
	test.skipIf(skip)("reaches the page as emit('shortcut', { accelerator })", async () => {
		const adapter = darwinShortcutsAdapter();
		const plugin = createShortcutsPlugin(adapter);
		const emitted: Array<[string, unknown]> = [];
		const ctx: PluginContext = {
			emit: (event: string, data: unknown) => emitted.push([event, data]),
		};
		try {
			const registered = await plugin.commands.register(
				{ accelerator: "CommandOrControl+Shift+F19" },
				ctx,
			);
			expect(registered).toEqual({ ok: true, accelerator: "command+shift+f19" });
			expect(emitted).toEqual([]);
			expect(adapter.dispatch("command+shift+f19")).toBe(true);
			expect(emitted).toEqual([["shortcut", { accelerator: "command+shift+f19" }]]);
		} finally {
			await plugin.commands.unregisterAll();
		}
	});
});
