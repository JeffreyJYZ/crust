/**
 * `crust:power` push proofs. A notification fires outside any command, so the page's `ctx.emit`
 * is captured when the subscribe command runs; these tests drive that seam with a fake adapter and
 * assert the event name and payload a page would receive, plus every refusal the plugin must make.
 */

import { describe, expect, test } from "bun:test";
import { collector, fakePower } from "@/plugins/power-fake.ts";
import { createPowerPlugin, POWER_COMMANDS, POWER_EVENTS, powerPlugin } from "@/plugins/power.ts";
import { isNotImplemented } from "@/plugins/define.ts";

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

describe("power event refusals", () => {
	test("a platform without the notification refuses by name, installing no listener", async () => {
		const { adapter, calls, fireSleep, fireLock } = fakePower({ noNotifications: true });
		const plugin = createPowerPlugin(adapter);
		const { events, ctx } = collector();
		const sleep = await plugin.commands.onSleep(undefined, ctx);
		const lock = await plugin.commands.onLock(undefined, ctx);
		for (const answer of [sleep, lock]) {
			expect(isNotImplemented(answer)).toBe(true);
		}
		expect(sleep).toMatchObject({ requires: "NSWorkspaceWillSleepNotification" });
		expect(lock).toMatchObject({ requires: "com.apple.screenIsLocked" });
		fireSleep();
		fireLock();
		expect(events).toEqual([]);
		expect(calls).toEqual([]);
	});

	test("the default adapter-less plugin refuses both subscribe commands", async () => {
		const { ctx } = collector();
		for (const command of ["onSleep", "onLock"] as const) {
			const answer = await powerPlugin.commands[command](undefined, ctx);
			expect(isNotImplemented(answer)).toBe(true);
		}
	});

	test("the OS reporting no notification is a handler-error, not a silent success", async () => {
		const { adapter } = fakePower({ watchSleep: false, watchLock: false });
		const plugin = createPowerPlugin(adapter);
		const { ctx } = collector();
		expect(await plugin.commands.onSleep(undefined, ctx)).toMatchObject({
			ok: false,
			code: "handler-error",
		});
		expect(await plugin.commands.onLock(undefined, ctx)).toMatchObject({
			ok: false,
			code: "handler-error",
		});
	});

	test("a throwing native registration is a typed failure, never a rejected invoke", async () => {
		const { adapter } = fakePower();
		adapter.onSleep = () => {
			throw new Error("the notification center is gone");
		};
		const { ctx } = collector();
		expect(await createPowerPlugin(adapter).commands.onSleep(undefined, ctx)).toEqual({
			ok: false,
			code: "handler-error",
			message: "the notification center is gone",
		});
	});

	test("the command list includes both subscribe commands", () => {
		expect([...POWER_COMMANDS]).toContain("onSleep");
		expect([...POWER_COMMANDS]).toContain("onLock");
	});
});

describe("power event wiring", () => {
	test("a platform with no power source still registers power and refuses by name", async () => {
		const { nativePlugins } = await import("@/runtime-plugins.ts");
		const plugins = await nativePlugins([], undefined, {});
		const power = plugins.find((plugin) => plugin.name === "power");
		expect(power).toBeDefined();
		const commands = power?.commands as unknown as Record<
			string,
			(
				args: unknown,
				ctx: { emit: (event: string, data: unknown) => void },
			) => Promise<unknown>
		>;
		const { ctx } = collector();
		for (const command of ["onSleep", "onLock"]) {
			const answer = await commands[command]?.(undefined, ctx);
			expect(isNotImplemented(answer)).toBe(true);
		}
	});
});
