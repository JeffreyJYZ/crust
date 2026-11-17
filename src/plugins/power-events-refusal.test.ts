/**
 * `crust:power` refusals, split from `power-events.test.ts` so each file stays under the line cap.
 * A platform with no notification must answer `not-implemented` naming it, never a listener that
 * never fires; the OS reporting no notification is a `handler-error`, not a silent success.
 */

import { describe, expect, test } from "bun:test";
import { collector, fakePower } from "@/plugins/power-fake.ts";
import { createPowerPlugin, POWER_COMMANDS, powerPlugin } from "@/plugins/power.ts";
import { POWER_PUSH_COMMANDS } from "@/plugins/power-subscriptions.ts";
import { isNotImplemented } from "@/plugins/define.ts";

describe("power event refusals", () => {
	test("a platform without the notification refuses every command by name", async () => {
		const { adapter, calls, fireSleep, fireLock } = fakePower({ noNotifications: true });
		const plugin = createPowerPlugin(adapter);
		const { events, ctx } = collector();
		const answers = [];
		for (const command of POWER_PUSH_COMMANDS) {
			answers.push(await plugin.commands[command](undefined, ctx));
		}
		for (const answer of answers) expect(isNotImplemented(answer)).toBe(true);
		expect(answers[0]).toMatchObject({ requires: "NSWorkspaceWillSleepNotification" });
		expect(answers[1]).toMatchObject({ requires: "com.apple.screenIsLocked" });
		expect(answers[2]).toMatchObject({ requires: "NSWorkspaceDidWakeNotification" });
		expect(answers[3]).toMatchObject({ requires: "NSWorkspaceScreensDidSleepNotification" });
		expect(answers[4]).toMatchObject({ requires: "NSWorkspaceScreensDidWakeNotification" });
		expect(answers[5]).toMatchObject({ requires: "com.apple.screenIsUnlocked" });
		fireSleep();
		fireLock();
		expect(events).toEqual([]);
		expect(calls).toEqual([]);
	});

	test("the default adapter-less plugin refuses every subscribe command", async () => {
		const { ctx } = collector();
		for (const command of POWER_PUSH_COMMANDS) {
			const answer = await powerPlugin.commands[command](undefined, ctx);
			expect(isNotImplemented(answer)).toBe(true);
		}
	});

	test("the OS reporting no notification is a handler-error, not a silent success", async () => {
		const { adapter } = fakePower({ unwatched: POWER_PUSH_COMMANDS });
		const plugin = createPowerPlugin(adapter);
		const { ctx } = collector();
		for (const command of POWER_PUSH_COMMANDS) {
			expect(await plugin.commands[command](undefined, ctx)).toMatchObject({
				ok: false,
				code: "handler-error",
			});
		}
	});

	test("a throwing native registration is a typed failure, never a rejected invoke", async () => {
		const { adapter } = fakePower();
		adapter.onUnlock = () => {
			throw new Error("the notification center is gone");
		};
		const { ctx } = collector();
		expect(await createPowerPlugin(adapter).commands.onUnlock(undefined, ctx)).toEqual({
			ok: false,
			code: "handler-error",
			message: "the notification center is gone",
		});
	});

	test("every push command is declared in POWER_COMMANDS", () => {
		for (const command of POWER_PUSH_COMMANDS) {
			expect([...POWER_COMMANDS]).toContain(command);
		}
		expect(POWER_COMMANDS).toHaveLength(4 + POWER_PUSH_COMMANDS.length);
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
		for (const command of POWER_PUSH_COMMANDS) {
			const answer = await commands[command]?.(undefined, ctx);
			expect(isNotImplemented(answer)).toBe(true);
		}
	});
});
