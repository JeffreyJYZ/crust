/**
 * `crust:window` proofs, without a window.
 *
 * The point of the plugin is that a page can branch on the answer: every
 * command resolves a value, an unknown label is a typed failure rather than a
 * throw, and a platform with no adapter says `not-implemented` instead of
 * pretending the window moved. None of that needs AppKit, so all of it is here.
 */

import { describe, expect, test } from "bun:test";
import { isNotImplemented } from "./define";
import { PluginRegistry } from "./registry";
import {
	createWindowPlugin,
	WINDOW_COMMANDS,
	WindowAdapterError,
	type WindowNative,
	windowPlugin,
} from "./window";

const ctx = { emit: () => {} };

interface FakeWindow {
	open: boolean;
	title?: string;
}

/**
 * A fake platform: labels are tracked the way `DarwinPlatform` tracks them, so
 * a closed window stays listed (its number is 0) instead of vanishing.
 */
function fakeAdapter(labels: string[] = ["main"]): WindowNative & {
	calls: string[];
	windows: Map<string, FakeWindow>;
} {
	const windows = new Map<string, FakeWindow>(
		labels.map((label) => [label, { open: true } as FakeWindow]),
	);
	const calls: string[] = [];
	const require = (label: string): FakeWindow => {
		const entry = windows.get(label);
		if (!entry) {
			throw new WindowAdapterError("unknown-window", `no window labelled ${label}`);
		}
		return entry;
	};
	return {
		calls,
		windows,
		close: (label) => {
			calls.push(`close:${label}`);
			require(label).open = false;
		},
		focus: (label) => {
			calls.push(`focus:${label}`);
			require(label);
		},
		setTitle: (label, title) => {
			calls.push(`setTitle:${label}:${title}`);
			require(label).title = title;
		},
		list: () => [...windows.keys()],
		isOpen: (label) => require(label).open,
	};
}

describe("window plugin shape", () => {
	test("is named window and declares exactly the five commands", () => {
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

describe("no adapter", () => {
	test("every command answers a structured not-implemented naming NSWindow", () => {
		const plugin = createWindowPlugin();
		const results = [
			plugin.commands.close({ label: "main" }),
			plugin.commands.focus({ label: "main" }),
			plugin.commands.setTitle({ label: "main", title: "x" }),
			plugin.commands.list(),
			plugin.commands.isOpen({ label: "main" }),
		];

		for (const result of results) {
			expect(isNotImplemented(result)).toBe(true);
			if (isNotImplemented(result)) expect(result.requires).toBe("NSWindow");
		}
	});

	test("the registry turns that into a not-implemented CrustError", async () => {
		const registry = new PluginRegistry().register(createWindowPlugin());
		await expect(registry.invoke("window", "list", {}, ctx)).rejects.toMatchObject({
			code: "not-implemented",
			requires: "NSWindow",
		});
	});
});

describe("through the registry", () => {
	test("an adapted plugin answers setTitle and isOpen as values", async () => {
		const adapter = fakeAdapter();
		const registry = new PluginRegistry().register(createWindowPlugin(adapter));

		expect(
			await registry.invoke("window", "setTitle", { label: "main", title: "From page" }, ctx),
		).toEqual({ ok: true, label: "main", title: "From page" });
		expect(await registry.invoke("window", "isOpen", { label: "main" }, ctx)).toEqual({
			ok: true,
			label: "main",
			open: true,
		});
		expect(await registry.invoke("window", "list", {}, ctx)).toEqual({
			ok: true,
			labels: ["main"],
		});

		// A dead command on an unknown label still resolves; only a missing
		// plugin or command is a rejection.
		expect(await registry.invoke("window", "focus", { label: "ghost" }, ctx)).toMatchObject({
			ok: false,
			code: "unknown-window",
		});
	});
});
