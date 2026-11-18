/**
 * The four added app events and the two rules that keep them honest: a listener
 * that throws never blocks a deferred quit's settle, and `info()` reports the
 * process's identity rather than a guessed bundle.
 */

import { describe, expect, test } from "bun:test";
import { waitFor } from "../scripts/harness/wait.ts";

import { createApp } from "@/app.ts";
import { type AppEvent, type AppListener, type LifecycleSource } from "@/app-types.ts";
import { watchLifecycle } from "@/app-loop.ts";
import type { CrustConfig } from "@/config";

const CONFIG: CrustConfig = {
	app: { id: "land.jyz.lifecycle", name: "lifecycle", version: "1.2.3" },
	windows: [],
};

type Listeners = Map<AppEvent, Set<AppListener>>;

function listeners(): Listeners {
	return new Map();
}

function listen(map: Listeners, event: AppEvent, fn: AppListener): void {
	const set = map.get(event) ?? new Set<AppListener>();
	set.add(fn);
	map.set(event, set);
}

describe("watchLifecycle", () => {
	test("each drained event wakes only its own listeners", async () => {
		const map = listeners();
		const heard: AppEvent[] = [];
		for (const event of ["activate", "before-quit", "will-quit", "reopen"] as const) {
			listen(map, event, () => void heard.push(event));
		}
		const queue: AppEvent[] = ["activate", "reopen", "will-quit", "before-quit"];
		const source: LifecycleSource = { take: () => queue.splice(0) };
		const handle = watchLifecycle(map, source, 10);
		await waitFor(() => (heard.length >= 4 ? heard : null), 2000, "lifecycle listeners");
		clearInterval(handle);

		expect(heard).toEqual(["activate", "reopen", "will-quit", "before-quit"]);
	});

	test("a throwing before-quit listener is named but still settles the quit", async () => {
		const map = listeners();
		listen(map, "before-quit", () => {
			throw new Error("listener blew up");
		});
		let settled = 0;
		let taken = 0;
		const source: LifecycleSource = {
			take: () => (taken++ === 0 ? ["before-quit"] : []),
			settle: () => void settled++,
		};
		const warn = console.warn;
		const warned: string[] = [];
		console.warn = (message: string) => void warned.push(message);
		const handle = watchLifecycle(map, source, 10);
		await waitFor(() => (settled >= 1 ? settled : null), 2000, "deferred quit settle");
		clearInterval(handle);
		console.warn = warn;

		expect(settled).toBe(1);
		expect(warned.some((line) => line.includes("before-quit listener threw"))).toBe(true);
	});

	test("a platform source that throws is skipped, not fatal", async () => {
		const map = listeners();
		listen(map, "activate", () => {
			throw new Error("must never run");
		});
		let takes = 0;
		const source: LifecycleSource = {
			take: () => {
				takes += 1;
				throw new Error("no such concept");
			},
		};
		const handle = watchLifecycle(map, source, 10);
		await waitFor(() => (takes >= 2 ? takes : null), 2000, "throwing source drain");
		clearInterval(handle);
	});
});

describe("app.info()", () => {
	test("reports config identity and this process's executable path", () => {
		const app = createApp(
			{
				start: async () => {},
				pump: () => {},
				createWindow: (options) => ({ label: options.label }),
				window: () => undefined,
				quit: () => {},
			},
			CONFIG,
		);
		expect(app.info()).toEqual({
			id: "land.jyz.lifecycle",
			name: "lifecycle",
			version: "1.2.3",
			execPath: process.execPath,
			packaged: false,
		});
	});
});
