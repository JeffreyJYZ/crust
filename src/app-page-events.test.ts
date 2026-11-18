/**
 * Lane R: a page hears the lifecycle events the backend already hears.
 *
 * The two rules proved here are the ones that would regress silently: the forward happens in the
 * same loop as `app.on` (so the two cannot drift), and one armed sink that throws never costs the
 * other sinks or the backend its event.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { waitFor } from "../scripts/harness/wait.ts";

import { createApp } from "@/app.ts";
import type { AppEvent, AppListener, LifecycleSource } from "@/app-types.ts";
import { watchLifecycle } from "@/app-loop.ts";
import {
	clearPageEvents,
	pageSinkCount,
	publishPageEvent,
	subscribePageEvents,
} from "@/app-watch.ts";
import { createAppNamespacePlugin } from "@/runtime-app-namespace.ts";

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

describe("app: events reach a page sink", () => {
	test("every drained lifecycle event is published as app:<event>, from the same loop", async () => {
		const map: Listeners = new Map();
		const backend: AppEvent[] = [];
		const page = arm(() => {});
		const source: LifecycleSource = {
			take: (() => {
				let drained = false;
				return () => {
					if (drained) return [];
					drained = true;
					return ["activate", "reopen"] as AppEvent[];
				};
			})(),
		};
		listen(map, "activate", () => void backend.push("activate"));
		listen(map, "reopen", () => void backend.push("reopen"));

		const handle = watchLifecycle(map, source, 10);
		await waitFor(
			() => (page.length >= 2 && backend.length >= 2 ? page : null),
			2000,
			"page lifecycle frames",
		);
		clearInterval(handle);

		expect(backend).toEqual(["activate", "reopen"]);
		expect(page.map((frame) => frame.event)).toEqual(["app:activate", "app:reopen"]);
		expect(page[0]?.data).toMatchObject({ event: "activate" });
	});

	test("a sink that throws is named and costs neither the other sink nor the backend", async () => {
		const good = arm(() => {});
		disarms.push(
			subscribePageEvents(() => {
				throw new Error("page sink blew up");
			}),
		);
		const warn = console.warn;
		const warned: string[] = [];
		console.warn = (message: string) => void warned.push(message);
		const backend: AppEvent[] = [];
		const map: Listeners = new Map();
		listen(map, "before-quit", () => void backend.push("before-quit"));
		const source: LifecycleSource = {
			take: (() => {
				let drained = false;
				return () => {
					if (drained) return [];
					drained = true;
					return ["before-quit"] as AppEvent[];
				};
			})(),
		};

		const handle = watchLifecycle(map, source, 10);
		await waitFor(
			() => (backend.length >= 1 && good.length >= 1 && warned.length >= 1 ? backend : null),
			2000,
			"throwing page sink delivery",
		);
		clearInterval(handle);
		console.warn = warn;

		expect(backend).toEqual(["before-quit"]);
		expect(good.map((frame) => frame.event)).toEqual(["app:before-quit"]);
		expect(warned.some((line) => line.includes("app:before-quit"))).toBe(true);
	});

	test("publishing with nothing armed is a no-op, not a throw", () => {
		expect(() => publishPageEvent("activate")).not.toThrow();
	});

	test("a disarmed sink stops hearing events", () => {
		const frames = arm(() => {});
		const disarm = subscribePageEvents((event) => void frames.push({ event, data: null }));
		disarm();
		publishPageEvent("reopen");
		expect(frames.map((frame) => frame.event)).toEqual(["app:reopen"]);
	});
});

describe("app.info() from a page", () => {
	test("the app namespace answers identity, and arms page delivery", async () => {
		const plugin = createAppNamespacePlugin();
		const ctx = { emit: () => {} };
		const handler = plugin.commands["info"];
		if (handler === undefined) throw new Error("app.info is not registered");
		const info = (await handler({}, ctx)) as { id: string; name: string };
		expect(typeof info.id).toBe("string");
		expect(pageSinkCount()).toBe(1);
	});

	test("an app with a config reports that identity through the command", async () => {
		const app = createApp(
			{
				start: async () => {},
				pump: () => {},
				createWindow: (options) => ({ label: options.label }),
				window: () => undefined,
				destroy: () => {},
				quit: () => {},
			},
			{ app: { id: "land.jyz.events", name: "events", version: "0.4.1" }, windows: [] },
		);
		expect(app.info()).toMatchObject({ id: "land.jyz.events", version: "0.4.1" });
	});
});
