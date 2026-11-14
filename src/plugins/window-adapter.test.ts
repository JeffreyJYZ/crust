/**
 * The real adapter (`darwinWindowAdapter`) against a platform double. Beyond delegating, `create` has exactly two jobs: decide whether a label is a live window or a stale closed one, and resolve a relative URL against the app's document — both ordering facts, so the double records calls and the assertions read that order. AppKit is not under test.
 */

import { describe, expect, test } from "bun:test";
import { darwinWindowAdapter, type DarwinPlatform } from "../platform/darwin";
import { WindowAdapterError } from "./window-types.ts";
import { createWindowPlugin } from "./window.ts";

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
