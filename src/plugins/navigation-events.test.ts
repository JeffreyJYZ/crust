/**
 * `crust:navigation` event proofs. A delegate callback fires outside any command, so the channel
 * is the context of the most recent one; these tests drive that seam with a fake adapter and
 * assert the event name and payload a page would receive, including the failure message WebKit
 * supplies.
 */

import { describe, expect, test } from "bun:test";
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

	test("a later command moves the channel, because emit lives only as long as one", () => {
		const { adapter, fire } = fakeNavigation();
		const plugin = createNavigationPlugin(adapter);
		const first = collector();
		const second = collector();
		plugin.commands.start(undefined, first.ctx);
		plugin.commands.state(undefined, second.ctx);
		fire("did-finish");
		expect(first.events).toEqual([]);
		expect(second.events.map((entry) => entry.event)).toEqual(["navigation:did-finish"]);
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
