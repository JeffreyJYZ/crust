/**
 * `crust:power` push proofs. A notification fires outside any command, so the page's `ctx.emit`
 * is captured when the subscribe command runs; these tests drive that seam with a fake adapter and
 * assert the event name and payload a page would receive. The refusals live in
 * `power-events-refusal.test.ts` so each file stays under the line cap.
 */

import { describe, expect, test } from "bun:test";
import { collector, fakePower } from "@/plugins/power-fake.ts";
import { createPowerPlugin, POWER_EVENTS } from "@/plugins/power.ts";

describe("power plugin events", () => {
	test("onSleep arms the observer and each report reaches the page as power:sleep", async () => {
		const { adapter, calls, fireSleep } = fakePower();
		const plugin = createPowerPlugin(adapter);
		const { events, ctx } = collector();
		expect(await plugin.commands.onSleep(undefined, ctx)).toEqual({
			ok: true,
			event: POWER_EVENTS.sleep,
		});
		fireSleep();
		fireSleep();
		expect(events).toEqual([
			{ event: "power:sleep", data: { kind: "sleep" } },
			{ event: "power:sleep", data: { kind: "sleep" } },
		]);
		expect(calls).toEqual(["onSleep"]);
	});

	test("onLock is a distinct observer and event", async () => {
		const { adapter, fireLock, fireSleep } = fakePower();
		const plugin = createPowerPlugin(adapter);
		const { events, ctx } = collector();
		expect(await plugin.commands.onLock(undefined, ctx)).toEqual({
			ok: true,
			event: POWER_EVENTS.lock,
		});
		fireLock();
		fireSleep(); // no sleep observer was registered, so nothing is emitted
		expect(events).toEqual([{ event: "power:lock", data: { kind: "lock" } }]);
	});

	test("the two observers can be armed together and multiplex onto their own events", async () => {
		const { adapter, fireSleep, fireLock } = fakePower();
		const plugin = createPowerPlugin(adapter);
		const { events, ctx } = collector();
		await plugin.commands.onSleep(undefined, ctx);
		await plugin.commands.onLock(undefined, ctx);
		fireLock();
		fireSleep();
		expect(events.map((entry) => entry.event)).toEqual(["power:lock", "power:sleep"]);
	});

	test("a subscriber that throws does not escape into the notification callback", async () => {
		const { adapter, fireSleep } = fakePower();
		const plugin = createPowerPlugin(adapter);
		await plugin.commands.onSleep(undefined, {
			emit: () => {
				throw new Error("the page's own handler failed");
			},
		});
		expect(() => fireSleep()).not.toThrow();
	});

	test("a report before any subscribe emits nothing", () => {
		const { fireSleep, fireLock } = fakePower();
		const { events } = collector();
		expect(() => fireSleep()).not.toThrow();
		expect(() => fireLock()).not.toThrow();
		expect(events).toEqual([]);
	});
});

/** Each added command, the page event it arms, the payload kind, and the notification it needs. */
const ADDED = [
	["onWake", POWER_EVENTS.wake, "wake", "NSWorkspaceDidWakeNotification"],
	[
		"onScreenSleep",
		POWER_EVENTS.screensleep,
		"screensleep",
		"NSWorkspaceScreensDidSleepNotification",
	],
	[
		"onScreenWake",
		POWER_EVENTS.screenwake,
		"screenwake",
		"NSWorkspaceScreensDidWakeNotification",
	],
	["onUnlock", POWER_EVENTS.unlock, "unlock", "com.apple.screenIsUnlocked"],
] as const;

describe("power event: the four added push events", () => {
	test.each(ADDED)(
		"%s arms its own observer and each report emits %s",
		async (command, event, kind) => {
			const { adapter, calls, fire } = fakePower();
			const plugin = createPowerPlugin(adapter);
			const { events, ctx } = collector();
			expect(await plugin.commands[command](undefined, ctx)).toEqual({ ok: true, event });
			fire(command);
			fire(command);
			expect(events).toEqual([
				{ event, data: { kind } },
				{ event, data: { kind } },
			]);
			expect(calls).toEqual([command]);
		},
	);

	test("all six observers multiplex onto their own events", async () => {
		const { adapter, fire } = fakePower();
		const plugin = createPowerPlugin(adapter);
		const { events, ctx } = collector();
		await plugin.commands.onSleep(undefined, ctx);
		await plugin.commands.onLock(undefined, ctx);
		for (const [command] of ADDED) {
			await plugin.commands[command](undefined, ctx);
			fire(command);
			fire("onSleep");
			fire("onLock");
		}
		expect(events.map((entry) => entry.event)).toEqual([
			"power:wake",
			"power:sleep",
			"power:lock",
			"power:screensleep",
			"power:sleep",
			"power:lock",
			"power:screenwake",
			"power:sleep",
			"power:lock",
			"power:unlock",
			"power:sleep",
			"power:lock",
		]);
	});
});
