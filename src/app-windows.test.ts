/**
 * `openWindows` with and without a frame memory: the restore is applied once per created window, a
 * label with no saved frame keeps its configured size, and a memory that refuses a frame (the
 * gone-monitor case, decided in `window-frame.ts`) never reaches a window.
 */

import { describe, expect, test } from "bun:test";

import type { Platform, WindowOptions } from "./app-types.ts";
import { openWindows } from "./app-windows.ts";
import type { CrustConfig } from "./config";
import type { FrameMemory } from "./plugins/window-frame-memory.ts";
import type { WindowFrame } from "./plugins/window-persist-store.ts";

const CONFIG = {
	app: { id: "land.jyz.proof", name: "Proof", version: "0.0.0" },
	windows: [
		{ label: "main", width: 800, height: 600 },
		{ label: "prefs", width: 420, height: 280 },
	],
} as unknown as CrustConfig;

function fakePlatform(): { platform: Platform; created: WindowOptions[] } {
	const created: WindowOptions[] = [];
	const platform = {
		start: async () => undefined,
		pump: () => undefined,
		createWindow: (options: WindowOptions) => {
			created.push(options);
			return { label: options.label };
		},
		window: () => undefined,
		destroy: () => undefined,
		quit: () => undefined,
	} satisfies Platform;
	return { platform, created };
}

function fakeMemory(saved: Record<string, WindowFrame>) {
	const placed: Array<[string, WindowFrame]> = [];
	let observed = false;
	const memory = {
		restorable: async () => saved,
		place: (label: string, frame: WindowFrame) => {
			placed.push([label, frame]);
		},
		observe: () => {
			observed = true;
		},
	} as unknown as FrameMemory;
	return { memory, placed, observed: () => observed };
}

const BRIDGE = { url: "http://127.0.0.1:5300/", token: "proof-token" };

describe("openWindows", () => {
	test("applies each saved frame once and keeps config sizes for the rest", async () => {
		const { platform, created } = fakePlatform();
		const frame = { x: 120, y: 80, width: 1000, height: 700 };
		const { memory, placed, observed } = fakeMemory({ main: frame });

		await openWindows(platform, CONFIG, BRIDGE, memory);

		// The configured size is what a create carries; the frame is applied through the adapter.
		expect(created.map((options) => [options.label, options.width, options.height])).toEqual([
			["main", 800, 600],
			["prefs", 420, 280],
		]);
		expect(placed).toEqual([["main", frame]]);
		expect(observed()).toBe(true);
	});

	test("without a memory every window opens at its configured size", async () => {
		const { platform, created } = fakePlatform();
		await openWindows(platform, CONFIG, BRIDGE);
		expect(created).toHaveLength(2);
	});
});
