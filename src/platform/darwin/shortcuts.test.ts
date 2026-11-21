/**
 * The Carbon half of `crust:shortcut`, driven without the keyboard: `dispatch` builds the event a press would have carried and sends it to the application event target, so the installed handler runs exactly as on a press. No `CGEventPost`, no HID post, no cursor, no accessibility grant.
 * It cannot prove macOS would route a real key press to the hot key — that needs a person and a key — so that stays stated in the report rather than faked.
 */

import { describe, expect, test } from "bun:test";
import type { PluginContext } from "@/plugins/define.ts";
import { parseAccelerator } from "@/plugins/shortcut-accelerator.ts";
import { createShortcutsPlugin } from "@/plugins/shortcuts.ts";
import {
	darwinShortcutsAdapter,
	type ShortcutUnit,
	shortcutUnit,
	shortcutUnitStatus,
} from "./shortcuts.ts";

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

/** A native unit that refuses the first N removals, so the OS-side retry is observable. */
function refusingUnit(refusals: number) {
	const state = { unregister: 0, unregisterAll: 0, next: 1 };
	const symbols = {
		shortcut_abi: () => 1,
		shortcut_install: () => 1,
		shortcut_register: () => state.next++,
		shortcut_unregister: () => (++state.unregister <= refusals ? 0 : 1),
		shortcut_unregister_all: () => (++state.unregisterAll <= refusals ? 0 : 1),
		shortcut_dispatch: () => 1,
		shortcut_event_abi: () => 31,
	};
	return { unit: { symbols } as unknown as ShortcutUnit, state };
}

describe("unregister failure and retry", () => {
	test("a refused OS removal keeps the key so the retry reaches the OS again", () => {
		const { unit, state } = refusingUnit(1);
		const adapter = darwinShortcutsAdapter(unit);
		const parsed = parseAccelerator("Cmd+K");
		expect(adapter.register(parsed).ok).toBe(true);

		expect(adapter.unregister(parsed)).toBe(false);
		// Bookkeeping survived: the press still has a route and a second call still reaches C.
		expect(adapter.dispatch(parsed.accelerator)).toBe(true);
		expect(adapter.unregister(parsed)).toBe(true);
		expect(state.unregister).toBe(2);
		expect(adapter.dispatch(parsed.accelerator)).toBe(false);
	});

	test("a refused unregisterAll keeps every key so the retry reaches the OS again", () => {
		const { unit, state } = refusingUnit(1);
		const adapter = darwinShortcutsAdapter(unit);
		adapter.register(parseAccelerator("Cmd+K"));
		adapter.register(parseAccelerator("Cmd+J"));

		expect(adapter.unregisterAll()).toBe(0);
		expect(adapter.dispatch("command+k")).toBe(true);
		expect(adapter.dispatch("command+j")).toBe(true);
		expect(adapter.unregisterAll()).toBe(1);
		expect(state.unregisterAll).toBe(2);
	});
});
