/**
 * `crust:window` proofs, without a window.
 *
 * The point of the plugin is that a page can branch on the answer: every
 * command resolves a value, an unknown label is a typed failure rather than a
 * throw, and a platform with no adapter says `not-implemented` instead of
 * pretending the window moved. None of that needs AppKit, so all of it is here.
 *
 * `window.create` has one part a fake cannot prove — the adapter's own ordering
 * and URL resolution — so the last block drives `darwinWindowAdapter` (the real
 * one) against a platform double that records the calls. The adapter logic is
 * under test; AppKit is not.
 */

import { describe, expect, test } from "bun:test";
import { darwinWindowAdapter, type DarwinPlatform } from "../platform/darwin";
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
 *
 * `create` records the exact options it was handed, so a test can assert what
 * crossed the seam rather than only what the plugin answered — a create that
 * clamped a size or dropped a title would otherwise look identical.
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
		create: (options) => {
			calls.push(
				`create:${options.label}:${options.width ?? "-"}x${options.height ?? "-"}:` +
					`${options.title ?? "-"}:${options.url ?? "-"}`,
			);
			// `DarwinPlatform.createWindow` refuses a label still in its map, even
			// when the window was closed; only the platform can see that.
			if (windows.has(options.label)) {
				throw new WindowAdapterError(
					"duplicate-label",
					`crust: a window labelled ${JSON.stringify(options.label)} already exists`,
				);
			}
			windows.set(options.label, { open: true, title: options.title });
			return { label: options.label };
		},
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

describe("window.create", () => {
	/**
	 * The whole point of the command: after it answers, every other command finds
	 * the new window by the same label, which is what makes a reopen possible
	 * without keeping a hidden window alive.
	 */
	test("creates a window the other commands then find", () => {
		const adapter = fakeAdapter(["main"]);
		const plugin = createWindowPlugin(adapter);

		expect(
			plugin.commands.create({
				label: "prefs",
				title: "Preferences",
				width: 420,
				height: 280,
			}),
		).toEqual({ ok: true, label: "prefs", created: true });
		expect(adapter.calls).toEqual(["create:prefs:420x280:Preferences:-"]);

		expect(plugin.commands.list()).toEqual({ ok: true, labels: ["main", "prefs"] });
		expect(plugin.commands.isOpen({ label: "prefs" })).toEqual({
			ok: true,
			label: "prefs",
			open: true,
		});
		expect(plugin.commands.setTitle({ label: "prefs", title: "Renamed" })).toEqual({
			ok: true,
			label: "prefs",
			title: "Renamed",
		});
		expect(adapter.windows.get("prefs")?.title).toBe("Renamed");

		expect(plugin.commands.close({ label: "prefs" })).toEqual({
			ok: true,
			label: "prefs",
			closed: true,
		});
		expect(plugin.commands.isOpen({ label: "prefs" })).toEqual({
			ok: true,
			label: "prefs",
			open: false,
		});
	});

	test("a URL and no sizes cross the seam unchanged", () => {
		const adapter = fakeAdapter([]);
		const plugin = createWindowPlugin(adapter);

		expect(plugin.commands.create({ label: "docs", url: "https://example.com/docs" })).toEqual({
			ok: true,
			label: "docs",
			created: true,
		});
		// No width, height or title was invented: the platform's defaults are its
		// own, and a plugin that filled them in would silently override them.
		expect(adapter.calls).toEqual(["create:docs:-x-:-:https://example.com/docs"]);
	});

	test("a duplicate label is refused, names it, and never reaches the platform", () => {
		const adapter = fakeAdapter(["main"]);
		const plugin = createWindowPlugin(adapter);

		const result = plugin.commands.create({ label: "main" });
		expect(result).toMatchObject({ ok: false, code: "duplicate-label", label: "main" });
		if (!result.ok) expect(result.message).toContain('"main"');
		expect(adapter.calls).toEqual([]);
		expect(plugin.commands.list()).toEqual({ ok: true, labels: ["main"] });
	});

	/**
	 * The case only the platform can see: `DarwinPlatform` keeps a closed window
	 * addressable (`setReleasedWhenClosed: 0`), so a label it still holds refuses
	 * a re-create even though `windowLabels()` no longer lists it. The adapter
	 * throws the code; the plugin must not turn it into a bare handler-error.
	 */
	test("a label the adapter still holds is a duplicate, not a handler error", () => {
		const plugin = createWindowPlugin({
			create: (options) => {
				throw new WindowAdapterError(
					"duplicate-label",
					`crust: a window labelled ${JSON.stringify(options.label)} already exists`,
				);
			},
			close: () => {},
			focus: () => {},
			setTitle: () => {},
			list: () => [],
			isOpen: () => false,
		});

		const result = plugin.commands.create({ label: "prefs" });
		expect(result).toMatchObject({ ok: false, code: "duplicate-label", label: "prefs" });
		if (!result.ok) expect(result.message).toContain('"prefs"');
	});

	test("a create that does not track the label is an error, not a success", () => {
		const plugin = createWindowPlugin({
			create: (options) => ({ label: options.label }),
			close: () => {},
			focus: () => {},
			setTitle: () => {},
			list: () => [],
			isOpen: () => false,
		});

		expect(plugin.commands.create({ label: "ghost" })).toMatchObject({
			ok: false,
			code: "handler-error",
			label: "ghost",
		});
	});

	test("arguments are validated, never coerced or clamped", () => {
		const adapter = fakeAdapter([]);
		const plugin = createWindowPlugin(adapter);
		const type = (value: unknown) => value as { label: string };

		expect(plugin.commands.create({} as { label: string })).toMatchObject({
			ok: false,
			code: "invalid-label",
		});
		expect(plugin.commands.create(type({ label: 7 }))).toMatchObject({
			ok: false,
			code: "invalid-label",
		});
		expect(plugin.commands.create(type({ label: "" }))).toMatchObject({
			ok: false,
			code: "invalid-label",
		});
		expect(plugin.commands.create(type({ label: "ok", title: 5 }))).toMatchObject({
			ok: false,
			code: "invalid-label",
			label: "ok",
		});

		for (const size of [0, -1, 12.5, Number.NaN, "900", null] as unknown[]) {
			expect(plugin.commands.create(type({ label: "ok", width: size }))).toMatchObject({
				ok: false,
				code: "invalid-size",
			});
			expect(plugin.commands.create(type({ label: "ok", height: size }))).toMatchObject({
				ok: false,
				code: "invalid-size",
			});
		}

		for (const url of ["", 42, null] as unknown[]) {
			expect(plugin.commands.create(type({ label: "ok", url }))).toMatchObject({
				ok: false,
				code: "invalid-url",
			});
		}

		// Nothing invalid was ever handed to the platform, so no partial window was
		// built and then reported as a success.
		expect(adapter.calls).toEqual([]);
	});

	/**
	 * An adapter written before this command still satisfies `WindowNative`; the
	 * answer says which member is missing rather than failing to compile or
	 * pretending a window exists.
	 */
	test("an adapter with no create answers unknown-adapter", () => {
		const plugin = createWindowPlugin({
			close: () => {},
			focus: () => {},
			setTitle: () => {},
			list: () => ["main"],
			isOpen: () => true,
		});

		expect(plugin.commands.create({ label: "prefs" })).toMatchObject({
			ok: false,
			code: "unknown-adapter",
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
			plugin.commands.create({ label: "second" }),
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

	test("create reaches the adapter and the new label answers afterwards", async () => {
		const adapter = fakeAdapter(["main"]);
		const registry = new PluginRegistry().register(createWindowPlugin(adapter));

		expect(await registry.invoke("window", "create", { label: "second" }, ctx)).toEqual({
			ok: true,
			label: "second",
			created: true,
		});
		expect(await registry.invoke("window", "isOpen", { label: "second" }, ctx)).toEqual({
			ok: true,
			label: "second",
			open: true,
		});
		expect(await registry.invoke("window", "list", {}, ctx)).toEqual({
			ok: true,
			labels: ["main", "second"],
		});
	});
});

/**
 * The real adapter, against a platform double.
 *
 * `darwinWindowAdapter.create` has exactly two jobs beyond delegating: decide
 * whether a label is a live window or a stale closed one, and resolve a
 * relative URL against the app's own document. Both are ordering facts, so the
 * double records calls and the assertions read that order.
 */
describe("darwinWindowAdapter.create", () => {
	const APP_URL = "http://127.0.0.1:45000/";

	/** A platform double: `window(label)` reports liveness and prunes a closed entry. */
	function double(options: {
		open?: string[];
		closed?: string[];
		documents?: Record<string, string>;
	}): {
		platform: DarwinPlatform;
		calls: string[];
		created: { label: string; url?: string }[];
	} {
		const calls: string[] = [];
		const created: { label: string; url?: string }[] = [];
		const open = new Set(options.open ?? ["main"]);
		const closed = new Set(options.closed ?? []);
		const documents = options.documents ?? { main: APP_URL };
		const platform = {
			window(label: string) {
				calls.push(`window:${label}`);
				if (open.has(label)) return { label };
				closed.delete(label); // pruned, as the real one does
				return undefined;
			},
			windowLabels: () => [...open],
			windowUrl: (label: string) => documents[label],
			createWindow: (window: { label: string; url?: string }) => {
				calls.push(`createWindow:${window.label}:${window.url ?? "-"}`);
				created.push(window);
				open.add(window.label);
				return { label: window.label };
			},
			nativeWindow: (label: string) => (open.has(label) ? 1 : undefined),
			windowNumber: (label: string) => (open.has(label) ? 7 : 0),
			activateOnce: () => {},
		};
		return { platform: platform as unknown as DarwinPlatform, calls, created };
	}

	test("releases a stale closed label before delegating, and in that order", () => {
		const { platform, calls, created } = double({ open: ["main"], closed: ["second"] });
		const adapter = darwinWindowAdapter(platform);

		expect(adapter.create?.({ label: "second" })).toEqual({ label: "second" });
		// `window:` both answers liveness and prunes the closed entry; without it
		// the real `createWindow` throws `window "second" already exists`.
		expect(calls).toEqual(["window:second", `createWindow:second:${APP_URL}`]);
		expect(created[0]?.url).toBe(APP_URL);
	});

	test("a live label is refused before anything is created or released", () => {
		const { platform, calls, created } = double({ open: ["main"] });
		const adapter = darwinWindowAdapter(platform);

		expect(() => adapter.create?.({ label: "main" })).toThrow(WindowAdapterError);
		expect(calls).toEqual(["window:main"]);
		expect(created).toEqual([]);
	});

	test("a relative url resolves against the app's own document, absolute passes through", () => {
		const { platform, created } = double({ open: ["main"] });
		const adapter = darwinWindowAdapter(platform);

		adapter.create?.({ label: "a", url: "/second.html" });
		adapter.create?.({ label: "b", url: "?child=1" });
		adapter.create?.({ label: "c", url: "https://example.com/x" });
		adapter.create?.({ label: "d" });

		expect(created.map((entry) => entry.url)).toEqual([
			"http://127.0.0.1:45000/second.html",
			"http://127.0.0.1:45000/?child=1",
			"https://example.com/x",
			APP_URL,
		]);
	});

	test("with no document to resolve against it refuses instead of guessing", () => {
		const { platform } = double({ open: [], documents: {} });
		const adapter = darwinWindowAdapter(platform);

		expect(() => adapter.create?.({ label: "second", url: "/" })).toThrow(/absolute url/);
	});

	/** The plugin's own shape, produced by the real adapter rather than a fake. */
	test("through the plugin: closed label reopens, live label answers duplicate-label", () => {
		const { platform, created } = double({ open: ["main"], closed: ["second"] });
		const plugin = createWindowPlugin(darwinWindowAdapter(platform));

		expect(plugin.commands.create({ label: "second" })).toEqual({
			ok: true,
			label: "second",
			created: true,
		});
		expect(created).toHaveLength(1);

		const refused = plugin.commands.create({ label: "main" });
		expect(refused).toMatchObject({ ok: false, code: "duplicate-label", label: "main" });
		if (!refused.ok) expect(refused.message).toContain('"main"');
		expect(created).toHaveLength(1);
	});
});
