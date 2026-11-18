/**
 * `DarwinPlatform.destroy` proven without AppKit: the store seam is injected with a fake that
 * records closes and forgets labels, the same shape the real `createWindowStore` satisfies. No
 * `-close` is sent to C, so the test needs neither a window server nor a compiled shim.
 */
import { describe, expect, test } from "bun:test";
import { DarwinPlatform } from "./platform.ts";
import type { DarwinWindowStore } from "./window-store.ts";

interface FakeWindow {
	handle: { label: string };
	win: number;
	web: number;
	url: string;
	open: boolean;
}

function fakeStore() {
	const windows = new Map<string, FakeWindow>();
	const closed: string[] = [];
	const live = (label: string): FakeWindow | undefined => {
		const entry = windows.get(label);
		return entry?.open ? entry : undefined;
	};
	const store: DarwinWindowStore = {
		has: (label) => windows.has(label),
		track: (handle, pointers) =>
			windows.set(handle.label, {
				handle,
				win: pointers.win,
				web: pointers.web,
				url: pointers.url,
				open: true,
			}),
		handle: (label) => live(label)?.handle,
		labels: () =>
			[...windows.values()].filter((window) => window.open).map((w) => w.handle.label),
		url: (label) => windows.get(label)?.url,
		native: (label) => windows.get(label)?.win,
		webview: (label) => live(label)?.web,
		number: (label) => {
			const entry = windows.get(label);
			return entry === undefined ? undefined : entry.open ? entry.win : 0;
		},
		destroy(label) {
			const entry = windows.get(label);
			if (!entry) return;
			entry.open = false;
			closed.push(label);
			windows.delete(label);
		},
	};
	return { store, closed };
}

describe("DarwinPlatform.destroy", () => {
	test("closes main, removes its label and leaves the other window open", () => {
		const { store, closed } = fakeStore();
		const platform = new DarwinPlatform({}, store);
		store.track({ label: "main" }, { win: 101, web: 201, url: "about:blank" });
		store.track({ label: "other" }, { win: 102, web: 202, url: "about:blank" });
		platform.destroy("main");
		expect(closed).toEqual(["main"]); // only main received a native close
		expect(platform.window("main")).toBeUndefined();
		expect(platform.window("other")).toEqual({ label: "other" });
		expect(platform.windowLabels()).toEqual(["other"]);
	});
});
