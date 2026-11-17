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
 * Build the plugin. `adapter` may be absent (the default export) or lack the notification methods
 * (a platform without them); either way the affected commands refuse instead of faking an answer.
 */
export function createPowerPlugin(adapter?: PowerAdapter): PluginDefinition<
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
	const missing = (command: string) =>
		notImplemented(
			`power.${command} needs IOKit, which only macOS provides. Pass a PowerAdapter to ` +
				"createPowerPlugin on a platform that has no power source.",
			"IOPSCopyPowerSourcesInfo",
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
			sleepPrevent: async (
				args: SleepPreventArgs,
			): Promise<SleepPreventResult | PowerFailure | NotImplemented> => {
				if (!adapter) return missing("sleepPrevent");
				const reason = args?.reason;
				if (typeof reason !== "string" || reason.length === 0) {
					throw new CrustError(
						"bad-request",
						'power.sleepPrevent: "reason" must be a non-empty string',
					);
				}
				const answer = await adapter.preventSleep(reason);
				if (!answer.ok) return { ok: false, code: "handler-error", message: answer.reason };
				return { ok: true, id: answer.id };
			},

			/** Release the assertion; `released: false` means none was held, not that the OS refused. */
			sleepAllow: async (): Promise<SleepAllowResult | PowerFailure | NotImplemented> => {
				if (!adapter) return missing("sleepAllow");
				const answer = await adapter.allowSleep();
				if (!answer.ok) return { ok: false, code: "handler-error", message: answer.reason };
				return { ok: true, released: answer.released };
			},

			// The six push commands, built from one table in `power-subscriptions.ts`.
			...powerSubscribeHandlers(adapter),
		},
	});
}

/** The default registration: honest about the missing framework. */
export const powerPlugin = createPowerPlugin();
