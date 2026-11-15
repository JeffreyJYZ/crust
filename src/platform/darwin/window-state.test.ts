/**
 * The labelled state adapter's own rules, with the sends replaced by a double: geometry changes only the half it was given, fullscreen is a flip sent only when the state differs, and the flag is a level that reads back. No AppKit, no window.
 */

import { describe, expect, test } from "bun:test";
import { WindowAdapterError } from "@/plugins/window";
import { windowStateAdapter } from "./window-state-adapter.ts";
import { WINDOW_LEVEL, type WindowFrame, type WindowStateSends } from "./window-state.ts";

/** A window at (10, 20), 800×600, every flag off, recording every send. */
function double(): {
	adapter: ReturnType<typeof windowStateAdapter>;
	calls: string[];
	frame: () => WindowFrame;
} {
	const calls: string[] = [];
	let frame: WindowFrame = { x: 10, y: 20, width: 800, height: 600 };
	let level: number = WINDOW_LEVEL.normal;
	let fullscreen = false;
	let zoomed = false;
	let miniaturized = false;
	const sends: WindowStateSends = {
		frame: () => ({ ...frame }),
		setFrame: (_win, next) => {
			calls.push(`setFrame:${next.x},${next.y},${next.width},${next.height}`);
			frame = { ...next };
		},
		level: () => level,
		setLevel: (_win, next) => {
			calls.push(`setLevel:${next}`);
			level = next;
		},
		fullscreen: () => fullscreen,
		toggleFullscreen: () => {
			calls.push("toggleFullscreen");
			fullscreen = !fullscreen;
		},
		zoomed: () => zoomed,
		zoom: () => {
			calls.push("zoom");
			zoomed = !zoomed;
		},
		miniaturized: () => miniaturized,
		miniaturize: () => {
			calls.push("miniaturize");
			miniaturized = true;
		},
		deminiaturize: () => {
			calls.push("deminiaturize");
			miniaturized = false;
		},
	};
	const require = (label: string): number => {
		if (label !== "main") {
			throw new WindowAdapterError("unknown-window", `no window labelled ${label}`);
		}
		return 1;
	};
	return { adapter: windowStateAdapter(require, sends), calls, frame: () => frame };
}

describe("geometry", () => {
	test("a resize keeps the origin, a move keeps the size", () => {
		const { adapter, calls, frame } = double();

		expect(adapter.getSize?.("main")).toEqual({ width: 800, height: 600 });
		adapter.setSize?.("main", { width: 1024, height: 768 });
		expect(frame()).toEqual({ x: 10, y: 20, width: 1024, height: 768 });

		adapter.setPosition?.("main", { x: 300, y: 400 });
		expect(frame()).toEqual({ x: 300, y: 400, width: 1024, height: 768 });
		expect(adapter.getPosition?.("main")).toEqual({ x: 300, y: 400 });
		expect(calls).toEqual(["setFrame:10,20,1024,768", "setFrame:300,400,1024,768"]);
	});

	test("an unknown label is refused, not sent", () => {
		const { adapter, calls } = double();
		expect(() => adapter.getSize?.("ghost")).toThrow(WindowAdapterError);
		expect(() => adapter.minimize?.("ghost")).toThrow(/no window labelled/);
		expect(calls).toEqual([]);
	});
});

describe("levels and toggles", () => {
	test("always-on-top is the floating level, read back by measurement", () => {
		const { adapter, calls } = double();
		expect(adapter.isAlwaysOnTop?.("main")).toBe(false);
		adapter.setAlwaysOnTop?.("main", true);
		expect(adapter.isAlwaysOnTop?.("main")).toBe(true);
		adapter.setAlwaysOnTop?.("main", false);
		expect(adapter.isAlwaysOnTop?.("main")).toBe(false);
		expect(calls).toEqual([`setLevel:${WINDOW_LEVEL.floating}`, "setLevel:0"]);
	});

	test("fullscreen toggles once, because the selector is a flip", () => {
		const { adapter, calls } = double();

		adapter.setFullscreen?.("main", true);
		adapter.setFullscreen?.("main", true);
		expect(adapter.isFullscreen?.("main")).toBe(true);
		expect(calls).toEqual(["toggleFullscreen"]);

		adapter.setFullscreen?.("main", false);
		expect(adapter.isFullscreen?.("main")).toBe(false);
		expect(calls).toEqual(["toggleFullscreen", "toggleFullscreen"]);
	});

	test("minimize, unminimize, maximize and their reads", () => {
		const { adapter, calls } = double();
		expect(adapter.isMinimized?.("main")).toBe(false);
		adapter.minimize?.("main");
		expect(adapter.isMinimized?.("main")).toBe(true);
		adapter.unminimize?.("main");
		expect(adapter.isMinimized?.("main")).toBe(false);

		expect(adapter.isMaximized?.("main")).toBe(false);
		adapter.maximize?.("main");
		expect(adapter.isMaximized?.("main")).toBe(true);
		expect(calls).toEqual(["miniaturize", "deminiaturize", "zoom"]);
	});
});
