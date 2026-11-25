/**
 * Quit-path page delivery. The window-all-closed and app.quit() paths used to emit only to
 * backend listeners, so a page waiting for app:before-quit never heard it. Split from
 * app-page-events.test.ts to keep each file under the 200-line cap.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { waitFor } from "../scripts/harness/wait.ts";

import type { AppEvent, AppListener, LifecycleSource } from "@/app-types.ts";
import { clearPageEvents, emitOnQuit, pageSinkCount, subscribePageEvents } from "@/app-watch.ts";
import { watchLifecycle } from "@/app-loop.ts";

type Listeners = Map<AppEvent, Set<AppListener>>;
type Frame = { event: string; data: unknown };

function listen(map: Listeners, event: AppEvent, fn: AppListener): void {
	const set = map.get(event) ?? new Set<AppListener>();
	set.add(fn);
	map.set(event, set);
}

const disarms: Array<() => void> = [];
function arm(sink: (event: string, data: unknown) => void): Frame[] {
	const frames: Frame[] = [];
	disarms.push(subscribePageEvents((event, data) => void frames.push({ event, data })));
	void sink;
	return frames;
}

afterEach(() => {
	for (const disarm of disarms.splice(0)) disarm();
	clearPageEvents();
	expect(pageSinkCount()).toBe(0);
});
describe("quit-path page events", () => {
	test("window-all-closed and app.quit() publish app: frames, not just backend events", async () => {
		const page = arm(() => {});
		const map: Listeners = new Map();
		let backend = 0;
		listen(map, "window-all-closed", () => void backend++);
		listen(map, "before-quit", () => void backend++);
		listen(map, "will-quit", () => void backend++);

		await emitOnQuit(map, "window-all-closed");
		await emitOnQuit(map, "before-quit");
		await emitOnQuit(map, "will-quit");

		expect(page.map((frame) => frame.event)).toEqual([
			"app:window-all-closed",
			"app:before-quit",
			"app:will-quit",
		]);
		expect(backend).toBe(3);
	});

	test("a throwing page sink never blocks the quit fan-out", async () => {
		const good = arm(() => {});
		const warned: string[] = [];
		const warn = console.warn;
		console.warn = (message: string) => void warned.push(message);
		disarms.push(
			subscribePageEvents(() => {
				throw new Error("page is gone");
			}),
		);
		try {
			await expect(emitOnQuit(new Map(), "before-quit")).resolves.toBeUndefined();
		} finally {
			console.warn = warn;
		}
		expect(good.map((frame) => frame.event)).toEqual(["app:before-quit"]);
		expect(warned.some((line) => line.includes("app:before-quit"))).toBe(true);
	});

	test("a native drain publishes one frame per event and waits for its backend listeners", async () => {
		const page = arm(() => {});
		const map: Listeners = new Map();
		const order: string[] = [];
		listen(map, "activate", async () => {
			order.push("activate:start");
			await Bun.sleep(10);
			order.push("activate:end");
		});
		listen(map, "reopen", () => void order.push("reopen"));
		let settled = 0;
		const source: LifecycleSource = {
			take: (() => {
				let drained = false;
				return () => {
					if (drained) return [];
					drained = true;
					return ["activate", "reopen"] as AppEvent[];
				};
			})(),
			settle: () => void settled++,
		};

		const handle = watchLifecycle(map, source, 10);
		await waitFor(
			() => (page.length >= 2 && order.includes("reopen") ? true : null),
			2000,
			"serialised lifecycle drain",
		);
		clearInterval(handle);

		expect(order).toEqual(["activate:start", "activate:end", "reopen"]);
		expect(page.map((frame) => frame.event)).toEqual(["app:activate", "app:reopen"]);
		expect(settled).toBe(0);
	});

	test("a native before-quit publishes exactly one page frame and settles once", async () => {
		const page = arm(() => {});
		const map: Listeners = new Map();
		let settled = 0;
		const source: LifecycleSource = {
			take: (() => {
				let drained = false;
				return () => {
					if (drained) return [];
					drained = true;
					return ["before-quit"] as AppEvent[];
				};
			})(),
			settle: () => void settled++,
		};
		const handle = watchLifecycle(map, source, 10);
		await waitFor(() => (settled >= 1 && page.length >= 1 ? true : null), 2000, "quit settle");
		clearInterval(handle);

		expect(page.map((frame) => frame.event)).toEqual(["app:before-quit"]);
		expect(settled).toBe(1);
	});
});
