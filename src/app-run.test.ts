/**
 * The two rules `run()` must never break: a listener that throws still lets the app quit, and
 * "every window closed" counts the platform's live windows rather than the config's labels.
 */

import { describe, expect, test } from "bun:test";
import { waitFor } from "../scripts/harness/wait.ts";

import { createApp } from "@/app.ts";
import { watchWindows } from "@/app-loop.ts";
import type { CrustConfig } from "@/config";
import type { Platform } from "./app-types.ts";

const CONFIG: CrustConfig = {
	app: { id: "land.jyz.app-run", name: "app-run", version: "0.0.0" },
	windows: [{ label: "main", url: "/" }],
};

interface Fake extends Platform {
	quits: number;
	pumps: number;
	open: Set<string>;
	/** How many times the watch called `windowLabels`: a positive signal that a tick ran. */
	reads: number;
}

/** A platform with no native half: labels it holds are whatever `open` says. */
function fakePlatform(): Fake {
	const open = new Set<string>();
	const platform: Fake = {
		quits: 0,
		pumps: 0,
		open,
		reads: 0,
		start: async () => {},
		pump: () => void platform.pumps++,
		createWindow: (options) => {
			open.add(options.label);
			return { label: options.label };
		},
		window: (label) => (open.has(label) ? { label } : undefined),
		destroy: (label) => {
			open.delete(label);
		},
		quit: () => {
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

/** Wait until the watch has actually read the window set `count` times, not a fixed 600 ms. */
async function ticks(platform: Fake, count = 2): Promise<void> {
	await waitFor(
		() => (platform.reads >= count ? platform.reads : null),
		2000,
		`${count} window watch ticks`,
	);
}

describe("app.run()", () => {
	/**
	 * `emit` awaits each listener, so a rejection used to skip `platform.quit()` entirely: the pump
	 * kept a windowless process alive forever. The app must quit either way, and say why.
	 */
	test("a window-all-closed listener that throws still quits the app", async () => {
		const platform = fakePlatform();
		const app = createApp(platform, CONFIG, { url: "http://127.0.0.1:1", token: "t" });
		app.on("window-all-closed", () => {
			throw new Error("listener blew up");
		});

		await app.run();
		platform.open.clear();
		await waitFor(() => (platform.quits >= 1 ? platform.quits : null), 2000, "closed quit");

		expect(platform.quits).toBe(1);
		app.quit();
	});

	test("a throwing ready listener does not reject run or leave the platform half-started", async () => {
		const platform = fakePlatform();
		const app = createApp(platform, CONFIG, { url: "http://127.0.0.1:1", token: "t" });
		const warn = console.warn;
		const warned: string[] = [];
		console.warn = (message: string) => void warned.push(message);
		app.on("ready", () => {
			throw new Error("startup save failed");
		});
		try {
			await expect(app.run()).resolves.toBeUndefined();
		} finally {
			console.warn = warn;
		}
		// The pump and the watches are installed after `ready`; a throw used to skip all of them.
		expect(platform.pumps).toBe(1);
		expect(warned.some((line) => line.includes("ready listener threw"))).toBe(true);
		app.quit();
	});

	test("a quit begun during ready does not install watches the quitter will never clear", async () => {
		const platform = fakePlatform();
		const app = createApp(platform, CONFIG, { url: "http://127.0.0.1:1", token: "t" });
		app.on("window-all-closed", () => {});
		app.on("ready", () => app.quit());
		await app.run();
		// Let the 250 ms watch tick twice. With the quitter refusing post-quit handles the count
		// stays put; before the fix these intervals survived the quit forever.
		const atRun = platform.reads;
		await Bun.sleep(650);
		expect(platform.reads).toBe(atRun);
	});

	test("a window-all-closed listener that resolves quits the app once", async () => {
		const platform = fakePlatform();
		const app = createApp(platform, CONFIG, { url: "http://127.0.0.1:1", token: "t" });
		let heard = 0;
		app.on("window-all-closed", () => {
			heard += 1;
		});

		await app.run();
		platform.open.clear();
		await waitFor(() => (heard >= 1 ? heard : null), 2000, "closed listener");
		await waitFor(() => (platform.quits >= 1 ? platform.quits : null), 2000, "closed quit");

		expect(heard).toBe(1);
		expect(platform.quits).toBe(1);
		app.quit();
	});
});

describe("watchWindows", () => {
	/**
	 * `window.create` opens windows under labels the config never names. Counting `config.windows`
	 * reported "all closed" and quit the app while a page-created window was still on screen.
	 */
	test("a window opened outside the config keeps the app alive", async () => {
		const platform = fakePlatform();
		platform.createWindow({ label: "page-made", url: "/" });
		platform.open.delete("main");
		let closed = 0;
		const handle = watchWindows(CONFIG, platform, () => {
			closed += 1;
		});

		// Prove the watch ran twice while the extra window was open, then assert it stayed silent.
		await ticks(platform);
		expect(closed).toBe(0);

		platform.open.clear();
		await waitFor(() => (closed >= 1 ? closed : null), 2000, "last window closed");
		expect(closed).toBe(1);
		clearInterval(handle);
	});

	/** A platform that reports no label set is watched by its config windows, as before. */
	test("a platform without windowLabels falls back to the config windows", async () => {
		const platform: Platform = {
			start: async () => {},
			pump: () => {},
			createWindow: (options) => ({ label: options.label }),
			window: () => undefined,
			destroy: () => {},
			quit: () => {},
		};
		let closed = 0;
		const handle = watchWindows(CONFIG, platform, () => {
			closed += 1;
		});
		await waitFor(() => (closed >= 1 ? closed : null), 2000, "config fallback close");
		expect(closed).toBe(1);
		clearInterval(handle);
	});
});
