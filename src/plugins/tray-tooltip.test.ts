/**
 * `crust:tray.setTooltip` refusals: an adapter that cannot set a tooltip answers `not-implemented` naming `setToolTip:`, a platform with no status item names `NSStatusBar`, and a bad argument is its own typed failure. A tooltip must never be silently dropped — a hover hint that vanished looks identical to one that was applied.
 */

import { describe, expect, test } from "bun:test";

import { isNotImplemented } from "./define";
import { createTrayPlugin, type TrayNative } from "./tray.ts";

describe("tray.setTooltip refusals", () => {
	test("an adapter without a tooltip setter names setToolTip:", () => {
		// A status item on a platform with no tooltip call: the other members exist.
		const adapter = {
			setTitle: () => {},
			setMenu: () => {},
			show: () => {},
			hide: () => {},
			destroy: () => {},
		} satisfies TrayNative;
		const answer = createTrayPlugin(adapter).commands.setTooltip({ text: "hint" });
		expect(isNotImplemented(answer)).toBe(true);
		if (isNotImplemented(answer)) expect(answer.requires).toBe("setToolTip:");
	});

	test("no adapter at all names NSStatusBar", () => {
		const answer = createTrayPlugin().commands.setTooltip({ text: "hint" });
		expect(isNotImplemented(answer)).toBe(true);
		if (isNotImplemented(answer)) expect(answer.requires).toBe("NSStatusBar");
	});

	test("a missing or non-string text is its own typed failure naming setTooltip", () => {
		const adapter: TrayNative = {
			setTitle: () => {},
			setTooltip: () => {},
			setMenu: () => {},
			show: () => {},
			hide: () => {},
			destroy: () => {},
		};
		const plugin = createTrayPlugin(adapter);
		expect(plugin.commands.setTooltip({} as { text: string })).toMatchObject({
			ok: false,
			code: "invalid-text",
			message: expect.stringContaining("tray.setTooltip"),
		});
		expect(
			plugin.commands.setTooltip({ text: 7 } as unknown as { text: string }),
		).toMatchObject({
			ok: false,
			code: "invalid-text",
		});
	});

	test("a setter that throws becomes a typed handler-error, never a rejected invoke", () => {
		const adapter: TrayNative = {
			setTitle: () => {},
			setTooltip: () => {
				throw new Error("AppKit refused");
			},
			setMenu: () => {},
			show: () => {},
			hide: () => {},
			destroy: () => {},
		};
		expect(createTrayPlugin(adapter).commands.setTooltip({ text: "hint" })).toMatchObject({
			ok: false,
			code: "handler-error",
			message: "AppKit refused",
		});
	});
});
