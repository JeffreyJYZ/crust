/**
 * FIX 5: the window-all-closed quit is the most common one, but the platform's lifecycle source
 * only sees a user's ⌘Q. A save-on-quit listener registered with `app.on("before-quit")` must
 * still run before this path calls `platform.quit()` (which ends in `process.exit(0)`).
 */

import { describe, expect, test } from "bun:test";
import { waitFor } from "../scripts/harness/wait.ts";

import { createApp } from "@/app.ts";
import type { Platform } from "@/app-types.ts";
import type { CrustConfig } from "@/config";

const CONFIG: CrustConfig = {
	app: { id: "land.jyz.quit-events", name: "quit-events", version: "0.0.0" },
	windows: [{ label: "main", url: "/" }],
};

type Order = string[];

interface Fake extends Platform {
	quits: number;
	open: Set<string>;
	reads: number;
}

function fakePlatform(order: Order): Fake {
	const open = new Set<string>();
	const platform: Fake = {
		quits: 0,
		open,
		reads: 0,
		start: async () => {},
		pump: () => {},
		createWindow: (options) => {
			open.add(options.label);
			return { label: options.label };
		},
		window: (label) => (open.has(label) ? { label } : undefined),
		destroy: (label) => {
			open.delete(label);
		},
		quit: () => {
			order.push("quit");
			platform.quits += 1;
		},
		windowLabels: () => {
			platform.reads += 1;
			return [...open];
		},
	};
	open.add("main");
	return platform;
}

describe("window-all-closed quit events", () => {
	test("emits before-quit and will-quit before platform.quit()", async () => {
		const order: Order = [];
		const platform = fakePlatform(order);
		const app = createApp(platform, CONFIG, { url: "http://127.0.0.1:1", token: "t" });
		app.on("window-all-closed", () => void order.push("window-all-closed"));
		app.on("before-quit", () => void order.push("before-quit"));
		app.on("will-quit", () => void order.push("will-quit"));

		await app.run();
		platform.open.clear();
		await waitFor(() => (platform.quits >= 1 ? platform.quits : null), 2000, "closed quit");

		expect(order).toEqual([
			"window-all-closed",
			"before-quit",
			"will-quit",
			"quit",
		]);
		app.quit();
	});

	test("a throwing before-quit listener is named but still lets will-quit run and quits", async () => {
		const platform = fakePlatform([]);
		const app = createApp(platform, CONFIG, { url: "http://127.0.0.1:1", token: "t" });
		let willQuit = 0;
		app.on("window-all-closed", () => {});
		app.on("before-quit", () => {
			throw new Error("save blew up");
		});
		app.on("will-quit", () => void (willQuit += 1));

		const warn = console.warn;
		const warned: string[] = [];
		console.warn = (message: string) => void warned.push(message);
		await app.run();
		platform.open.clear();
		await waitFor(() => (platform.quits >= 1 ? platform.quits : null), 2000, "closed quit");
		console.warn = warn;

		expect(platform.quits).toBe(1);
		expect(willQuit).toBe(1);
		expect(warned.some((line) => line.includes("before-quit listener threw"))).toBe(true);
		app.quit();
	});
});
