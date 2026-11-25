/**
 * `crust:navigation` event proofs. A delegate callback fires outside any command, so the channel
 * is the context of the most recent one; these tests drive that seam with a fake adapter and
 * assert the event name and payload a page would receive, including the failure message WebKit
 * supplies.
 */

import { describe, expect, test } from "bun:test";
import { createRunner } from "@/bridge/server/invoke.ts";
import type { CommandHandler } from "@/plugins/define.ts";
import { collector, fakeNavigation, READY_STATE } from "@/plugins/navigation-fake.ts";
import { createNavigationPlugin } from "@/plugins/navigation.ts";

describe("navigation plugin events", () => {
	test("every delegate callback reaches the page as its own event", () => {
		const { adapter, fire } = fakeNavigation();
		const plugin = createNavigationPlugin(adapter);
		const { events, ctx } = collector();
		plugin.commands.start(undefined, ctx);
		fire("did-start");
		fire("did-commit");
		fire("did-finish");
		expect(events.map((entry) => entry.event)).toEqual([
			"navigation:did-start",
			"navigation:did-commit",
			"navigation:did-finish",
		]);
		expect(events[0]?.data).toEqual({ url: READY_STATE.url, title: READY_STATE.title });
	});

	test("a failed navigation carries the message WebKit gave", () => {
		const { adapter, fire } = fakeNavigation();
		const plugin = createNavigationPlugin(adapter);
		const { events, ctx } = collector();
		plugin.commands.start(undefined, ctx);
		fire("did-fail", {
			url: READY_STATE.url,
			title: READY_STATE.title,
			message: "The network connection was lost",
		});
		expect(events).toEqual([
			{
				event: "navigation:did-fail",
				data: {
					url: READY_STATE.url,
					title: READY_STATE.title,
					message: "The network connection was lost",
				},
			},
		]);
	});

	test("a later command does not move another page's listener", () => {
		const { adapter, fire } = fakeNavigation();
		const plugin = createNavigationPlugin(adapter);
		const first = collector();
		const second = collector();
		plugin.commands.start(undefined, first.ctx);
		plugin.commands.state(undefined, second.ctx);
		fire("did-finish");
		expect(first.events.map((entry) => entry.event)).toEqual(["navigation:did-finish"]);
		expect(second.events).toEqual([]);
	});

	test("two starts on one window keep both listeners and reinstall nothing", () => {
		const { adapter, calls, fire } = fakeNavigation();
		const plugin = createNavigationPlugin(adapter);
		const first = collector();
		const second = collector();
		expect(plugin.commands.start(undefined, first.ctx)).toMatchObject({ ok: true });
		expect(plugin.commands.start(undefined, second.ctx)).toMatchObject({ ok: true });
		// The native delegate is installed once; a second start must not ask again, or the
		// adapter's already-installed branch would delete the first page's listener.
		expect(calls.filter((call) => call === "start")).toHaveLength(1);
		fire("did-commit");
		expect(first.events.map((entry) => entry.event)).toEqual(["navigation:did-commit"]);
		expect(second.events.map((entry) => entry.event)).toEqual(["navigation:did-commit"]);
	});

	test("one page stopping leaves the other page listening until both have stopped", () => {
		const { adapter, calls, fire } = fakeNavigation();
		const plugin = createNavigationPlugin(adapter);
		const first = collector();
		const second = collector();
		plugin.commands.start(undefined, first.ctx);
		plugin.commands.start(undefined, second.ctx);
		expect(plugin.commands.stop(undefined, first.ctx)).toMatchObject({
			ok: true,
			stopped: false,
		});
		fire("did-finish");
		expect(first.events).toEqual([]);
		expect(second.events.map((entry) => entry.event)).toEqual(["navigation:did-finish"]);
		expect(plugin.commands.stop(undefined, second.ctx)).toMatchObject({
			ok: true,
			stopped: true,
		});
		expect(calls.filter((call) => call === "stop")).toHaveLength(1);
	});

	test("two pages sharing one process emit are still distinct when pageId is supplied", () => {
		const { adapter, fire } = fakeNavigation();
		const plugin = createNavigationPlugin(adapter);
		// Production shape: the bridge hands both pages the same emit function. Only `pageId`
		// distinguishes them, as it does for two documents in one window.
		let delivered = 0;
		const emit = () => void delivered++;
		const first = { emit, pageId: "doc-A" };
		const second = { emit, pageId: "doc-B" };
		expect(plugin.commands.start(undefined, first)).toMatchObject({ ok: true });
		expect(plugin.commands.start(undefined, second)).toMatchObject({ ok: true });
		expect(plugin.commands.stop(undefined, first)).toMatchObject({ ok: true, stopped: false });
		fire("did-finish");
		expect(delivered).toBe(1); // only the page that did not stop hears it
		expect(plugin.commands.stop(undefined, second)).toMatchObject({ ok: true, stopped: true });
	});

	test("the runner forwards the document token as the per-page identity", async () => {
		const { adapter, fire } = fakeNavigation();
		const plugin = createNavigationPlugin(adapter);
		const handlers = new Map<string, CommandHandler>([
			["navigation.start", (args, ctx) => plugin.commands.start(args as never, ctx)],
			["navigation.stop", (args, ctx) => plugin.commands.stop(args as never, ctx)],
		]);
		const frames: string[] = [];
		const run = createRunner(handlers, {
			emit: (event: string) => void frames.push(event),
		});
		await run("navigation", "start", undefined, "main", "main", 0, "doc-A");
		await run("navigation", "start", undefined, "main", "main", 0, "doc-B");
		fire("did-finish");
		expect(frames).toHaveLength(2);
		await run("navigation", "stop", undefined, "main", "main", 0, "doc-A");
		fire("did-finish");
		expect(frames).toHaveLength(3);
	});

	test("a callback before start emits nothing and does not throw", () => {
		const { fire } = fakeNavigation();
		expect(() => fire("did-start")).not.toThrow();
	});

	test("a listener that throws does not escape the delegate", () => {
		const { adapter, fire } = fakeNavigation();
		const plugin = createNavigationPlugin(adapter);
		plugin.commands.start(undefined, {
			emit: () => {
				throw new Error("the page's own handler failed");
			},
		});
		expect(() => fire("did-commit")).not.toThrow();
	});
});
