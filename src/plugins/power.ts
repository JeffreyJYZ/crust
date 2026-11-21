/**
 * `crust:power` — what the machine's power state is, how long the user has been idle, a sleep
 * assertion a long task can hold, and the six notifications a page can subscribe to. IOKit,
 * CoreGraphics and the notification centers are not here: macOS supplies `darwinPowerAdapter()`,
 * and a platform without them keeps answering a typed `NotImplemented`.
 * The pair that must never leak is `sleepPrevent` / `sleepAllow`: the plugin answers the assertion id
 * so a caller can release exactly what it took, `sleepAllow` reports `released: false` rather than an
 * error when nothing was held, and the darwin adapter also releases on process exit.
 * The `on*` commands are the push half: one command each registers a native observer, and every later
 * notification reaches the page as `power:<kind>` through `ctx.emit`.
 */

import { CrustError } from "../bridge/errors";
import { definePlugin, notImplemented, type NotImplemented, type PluginDefinition } from "./define";
import {
	type IdleResult,
	type PowerAdapter,
	type PowerFailure,
	type PowerStateResult,
	type SleepAllowResult,
	type SleepPreventArgs,
	type SleepPreventResult,
} from "./power-types";
import { powerSubscribeHandlers, type PowerSubscribeHandlers } from "./power-subscriptions.ts";

export {
	POWER_EVENTS,
	type IdleResult,
	type PowerAdapter,
	type PowerEventKind,
	type PowerEventName,
	type PowerEventPayload,
	type PowerFailure,
	type PowerReadFailure,
	type PowerState,
	type PowerStateResult,
	type PowerSubscribeResult,
	type SleepAllowResult,
	type SleepAssertion,
	type SleepPreventArgs,
	type SleepPreventResult,
	type SleepRelease,
} from "./power-types";

/** The commands in the order this plugin declares them. */
export const POWER_COMMANDS = [
	"state",
	"idleSeconds",
	"sleepPrevent",
	"sleepAllow",
	"onSleep",
	"onLock",
	"onWake",
	"onScreenSleep",
	"onScreenWake",
	"onUnlock",
] as const;

/**
 * What a refusal names, per platform: each OS reads power from its own API, and only darwin has an
 * adapter in-tree. Sources for the names: `IOPSCopyPowerSourcesInfo` is bound in
 * `src/platform/darwin/shim/105_power.c`; `RegisterPowerSettingNotification` is a User32.dll export
 * on Microsoft Learn's winuser.h page (Powrprof.dll exports the distinct
 * `PowerSettingRegisterNotification`); `org.freedesktop.UPower` is UPower's D-Bus service per
 * upower.freedesktop.org/docs/UPower.html.
 */
const REQUIRES: Record<string, string> = {
	darwin: "IOPSCopyPowerSourcesInfo",
	win32: "RegisterPowerSettingNotification in User32.dll",
	linux: "UPower on D-Bus (org.freedesktop.UPower)",
};

/**
 * Build the plugin. `adapter` may be absent (the default export) or lack the notification methods
 * (a platform without them); either way the affected commands refuse instead of faking an answer.
 * `platform` is injectable like in `createKeychainPlugin`, so a refusal can be pinned on any OS.
 */
export function createPowerPlugin(
	adapter?: PowerAdapter,
	platform: string = process.platform,
): PluginDefinition<
	"power",
	{
		state: () => Promise<PowerStateResult | PowerFailure | NotImplemented>;
		idleSeconds: () => Promise<IdleResult | PowerFailure | NotImplemented>;
		sleepPrevent: (
			args: SleepPreventArgs,
		) => Promise<SleepPreventResult | PowerFailure | NotImplemented>;
		sleepAllow: () => Promise<SleepAllowResult | PowerFailure | NotImplemented>;
	} & PowerSubscribeHandlers
> {
	const requires = REQUIRES[platform] ?? "a platform power source";
	/**
	 * One assertion per process. The native shim overwrites its single IOKit id on every prevent, so
	 * a second `sleepPrevent` would leak the first id and `sleepAllow` could only release the last.
	 * The plugin deduplicates instead: a second caller gets the id already held.
	 */
	let held: number | undefined;
	let taking: Promise<SleepPreventResult | PowerFailure> | undefined;

	const missing = (command: string) =>
		notImplemented(
			`power.${command} needs ${requires}. Pass a PowerAdapter to createPowerPlugin on a ` +
				"platform that has no power source.",
			requires,
		);
	return definePlugin({
		name: "power",
		commands: {
			/** Battery, wall power and the low-power flag, in one read. */
			state: async (): Promise<PowerStateResult | PowerFailure | NotImplemented> => {
				if (!adapter) return missing("state");
				const answer = await adapter.state();
				if (answer.available === false) {
					return {
						ok: false,
						code: "handler-error",
						message: answer.reason ?? "power.state: the native read did not happen",
					};
				}
				return {
					ok: true,
					onAc: answer.onAc,
					batteryPercent: answer.batteryPercent,
					lowPowerMode: answer.lowPowerMode,
				};
			},

			/** Seconds since the last input event, from the combined session state. */
			idleSeconds: async (): Promise<IdleResult | PowerFailure | NotImplemented> => {
				if (!adapter) return missing("idleSeconds");
				const seconds = await adapter.idleSeconds();
				if (typeof seconds !== "number") {
					return { ok: false, code: "handler-error", message: seconds.reason };
				}
				return { ok: true, seconds: Number.isFinite(seconds) ? seconds : 0 };
			},

			/** Hold off idle sleep until `sleepAllow`, or until the process exits. */
			sleepPrevent: (
				args: SleepPreventArgs,
			): Promise<SleepPreventResult | PowerFailure | NotImplemented> => {
				if (!adapter) return Promise.resolve(missing("sleepPrevent"));
				const reason = args?.reason;
				if (typeof reason !== "string" || reason.length === 0) {
					return Promise.reject(
						new CrustError(
							"bad-request",
							'power.sleepPrevent: "reason" must be a non-empty string',
						),
					);
				}
				if (held !== undefined) return Promise.resolve({ ok: true, id: held });
				if (taking !== undefined) return taking;
				const work = (async (): Promise<SleepPreventResult | PowerFailure> => {
					const answer = await adapter.preventSleep(reason);
					if (!answer.ok)
						return { ok: false, code: "handler-error", message: answer.reason };
					held = answer.id;
					return { ok: true, id: answer.id };
				})();
				taking = work;
				void work.finally(() => {
					taking = undefined;
				});
				return work;
			},

			/** Release the assertion; `released: false` means none was held, not that the OS refused. */
			sleepAllow: async (): Promise<SleepAllowResult | PowerFailure | NotImplemented> => {
				if (!adapter) return missing("sleepAllow");
				const answer = await adapter.allowSleep();
				if (!answer.ok) return { ok: false, code: "handler-error", message: answer.reason };
				held = undefined;
				return { ok: true, released: answer.released };
			},

			// The six push commands, built from one table in `power-subscriptions.ts`.
			...powerSubscribeHandlers(adapter),
		},
	});
}

/** The default registration: honest about the missing framework. */
export const powerPlugin = createPowerPlugin();
