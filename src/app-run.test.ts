/**
 * The two rules `run()` must never break: a listener that throws still lets the app quit, and
 * "every window closed" counts the platform's live windows rather than the config's labels.
 */

import { describe, expect, test } from "bun:test";

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
	open: Set<string>;
}

/** A platform with no native half: labels it holds are whatever `open` says. */
function fakePlatform(): Fake {
	const open = new Set<string>();
	const platform: Fake = {
		quits: 0,
		open,
		start: async () => {},
		pump: () => {},
		createWindow: (options) => {
			open.add(options.label);
			return { label: options.label };
		},
		window: (label) => (open.has(label) ? { label } : undefined),
		quit: () => {
			platform.quits += 1;
		},
		windowLabels: () => [...open],
	};
	open.add("main");
	return platform;
}

/** Wait for the 250 ms watch tick plus the emit that follows it. */
async function tick(): Promise<void> {
	await Bun.sleep(600);
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
		await tick();

		expect(platform.quits).toBe(1);
		app.quit();
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
		await tick();

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

		await tick();
		expect(closed).toBe(0);

		platform.open.clear();
		await tick();
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
			quit: () => {},
		};
		let closed = 0;
		const handle = watchWindows(CONFIG, platform, () => {
			closed += 1;
		});
		await tick();
		expect(closed).toBe(1);
		clearInterval(handle);
	});
});
