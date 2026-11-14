/**
 * `crust:window` proofs, without a window. A page must be able to branch on every answer: each command resolves a value, an unknown label is a typed failure rather than a throw, and a platform with no adapter says `not-implemented` instead of pretending the window moved. `create` in its own suites; the registry path in `window-registry.test.ts`.
 */

import { describe, expect, test } from "bun:test";
import { fakeAdapter } from "./window-fake.ts";
import { WindowAdapterError } from "./window-types.ts";
import { createWindowPlugin, WINDOW_COMMANDS, windowPlugin } from "./window.ts";

describe("window plugin shape", () => {
	test("is named window and declares exactly the six commands", () => {
		const plugin = createWindowPlugin(fakeAdapter());
		expect(plugin.name).toBe("window");
		expect(Object.keys(plugin.commands).sort()).toEqual([...WINDOW_COMMANDS].sort());
		expect(Object.isFrozen(plugin)).toBe(true);
	});

	test("the default export is the adapter-less one", () => {
		expect(windowPlugin.name).toBe("window");
		expect(Object.keys(windowPlugin.commands).sort()).toEqual([...WINDOW_COMMANDS].sort());
	});
});

describe("window commands with an adapter", () => {
	test("close, focus and setTitle reach the adapter and answer typed values", () => {
		const adapter = fakeAdapter();
		const plugin = createWindowPlugin(adapter);

		expect(plugin.commands.close({ label: "main" })).toEqual({
			ok: true,
			label: "main",
			closed: true,
		});
		expect(plugin.commands.focus({ label: "main" })).toEqual({
			ok: true,
			label: "main",
			focused: true,
		});
		expect(plugin.commands.setTitle({ label: "main", title: "Window test" })).toEqual({
			ok: true,
			label: "main",
			title: "Window test",
		});
		expect(adapter.calls).toEqual(["close:main", "focus:main", "setTitle:main:Window test"]);
		expect(adapter.windows.get("main")?.title).toBe("Window test");
	});

	test("list and isOpen reflect the adapter, and closed is not unknown", () => {
		const adapter = fakeAdapter(["main", "prefs"]);
		const plugin = createWindowPlugin(adapter);

		expect(plugin.commands.list()).toEqual({ ok: true, labels: ["main", "prefs"] });
		expect(plugin.commands.isOpen({ label: "prefs" })).toEqual({
			ok: true,
			label: "prefs",
			open: true,
		});

		plugin.commands.close({ label: "prefs" });
		// Still tracked, so it is a `false` answer and not an unknown label.
		expect(plugin.commands.list()).toEqual({ ok: true, labels: ["main", "prefs"] });
		expect(plugin.commands.isOpen({ label: "prefs" })).toEqual({
			ok: true,
			label: "prefs",
			open: false,
		});

		// The list a page receives is a copy, so mutating it cannot desync state.
		const listed = plugin.commands.list();
		if (listed.ok) listed.labels.push("ghost");
		expect(plugin.commands.list()).toEqual({ ok: true, labels: ["main", "prefs"] });
	});

	/**
	 * What `window-all-closed` depends on: closing is a state change the very
	 * next `isOpen` must see, and repeating it stays a value rather than a throw.
	 */
	test("close makes isOpen false, and closing twice still answers", () => {
		const plugin = createWindowPlugin(fakeAdapter());
		expect(plugin.commands.close({ label: "main" })).toEqual({
			ok: true,
			label: "main",
			closed: true,
		});
		expect(plugin.commands.isOpen({ label: "main" })).toEqual({
			ok: true,
			label: "main",
			open: false,
		});
		expect(plugin.commands.close({ label: "main" })).toEqual({
			ok: true,
			label: "main",
			closed: true,
		});
	});
});

describe("typed failures", () => {
	test("an unknown label is a value, never a throw", () => {
		const plugin = createWindowPlugin(fakeAdapter());

		for (const command of ["close", "focus", "isOpen"] as const) {
			const result = plugin.commands[command]({ label: "nope" });
			expect(result).toMatchObject({ ok: false, code: "unknown-window", label: "nope" });
		}
		expect(plugin.commands.setTitle({ label: "nope", title: "x" })).toMatchObject({
			ok: false,
			code: "unknown-window",
			label: "nope",
		});
	});

	test("a missing or non-string label is its own typed failure", () => {
		const plugin = createWindowPlugin(fakeAdapter());
		expect(plugin.commands.close({} as { label: string })).toMatchObject({
			ok: false,
			code: "invalid-label",
		});
		expect(plugin.commands.isOpen({ label: 7 } as unknown as { label: string })).toMatchObject({
			ok: false,
			code: "invalid-label",
		});
		expect(
			plugin.commands.setTitle({ label: "main" } as { label: string; title: string }),
		).toMatchObject({ ok: false, code: "invalid-label", label: "main" });
	});

	test("an adapter that throws is converted, not propagated", () => {
		const plugin = createWindowPlugin({
			close: () => {
				throw new WindowAdapterError("handler-error", "selector refused");
			},
			focus: () => {},
			setTitle: () => {},
			list: () => ["main"],
			isOpen: () => {
				throw new Error("boom");
			},
		});

		expect(plugin.commands.close({ label: "main" })).toMatchObject({
			ok: false,
			code: "handler-error",
			message: "selector refused",
		});
		expect(plugin.commands.isOpen({ label: "main" })).toMatchObject({
			ok: false,
			code: "handler-error",
			message: "boom",
		});
	});
});
