/**
 * `crust:power` — what the machine's power state is, how long the user has been idle, and a sleep
 * assertion a long task can hold. IOKit and CoreGraphics are not here: macOS supplies
 * `darwinPowerAdapter()`, and a platform without them keeps answering a typed `NotImplemented`.
 * The pair that must never leak is `sleepPrevent` / `sleepAllow`: the plugin answers the assertion id
 * so a caller can release exactly what it took, `sleepAllow` reports `released: false` rather than an
 * error when nothing was held, and the darwin adapter also releases on process exit.
 */

import { CrustError } from "../bridge/errors";
import { definePlugin, type NotImplemented, notImplemented, type PluginDefinition } from "./define";

/** What the machine reports right now. */
export interface PowerState {
	onAc: boolean;
	/** 0–100, or null when the machine has no battery (a desktop is on wall power). */
	batteryPercent: number | null;
	lowPowerMode: boolean;
	/** False when the native read never reached the OS; the fields above are then placeholders. */
	available?: boolean;
	/** Why the read failed, present when `available` is false. */
	reason?: string;
}

/** A refused native read, so a fabricated reading never reaches a page as `ok: true`. */
export interface PowerReadFailure {
	available: false;
	reason: string;
}

/** One assertion attempt: the id it holds, or the step that refused it. */
export interface SleepAssertion {
	ok: boolean;
	id: number;
	reason: string;
}

/** One release attempt: `released` is false when nothing was held, which is not a failure. */
export interface SleepRelease {
	ok: boolean;
	released: boolean;
	reason: string;
}

/** The native half of `crust:power`; `platform/darwin/power.ts` implements it. */
export interface PowerAdapter {
	state(): PowerState | Promise<PowerState>;
	/** Seconds, or a refusal when the native clock read never reached the OS. */
	idleSeconds(): number | PowerReadFailure | Promise<number | PowerReadFailure>;
	preventSleep(reason: string): SleepAssertion | Promise<SleepAssertion>;
	allowSleep(): SleepRelease | Promise<SleepRelease>;
}

export interface SleepPreventArgs {
	/** Why sleep is being held off; IOKit shows it in `pmset -g assertions`. */
	reason: string;
}

export interface PowerStateResult extends PowerState {
	ok: true;
}

export interface IdleResult {
	ok: true;
	/** Seconds since the last input event in the combined session, fractional. */
	seconds: number;
}

export interface SleepPreventResult {
	ok: true;
	/** The assertion id, for a caller that wants to prove which one it holds. */
	id: number;
}

export interface SleepAllowResult {
	ok: true;
	released: boolean;
}

/** A refusal that is not a missing platform: the OS said no. */
export interface PowerFailure {
	ok: false;
	code: "handler-error";
	message: string;
}

/** The commands in the order this plugin declares them. */
export const POWER_COMMANDS = ["state", "idleSeconds", "sleepPrevent", "sleepAllow"] as const;

export function createPowerPlugin(adapter?: PowerAdapter): PluginDefinition<
	"power",
	{
		state: () => Promise<PowerStateResult | PowerFailure | NotImplemented>;
		idleSeconds: () => Promise<IdleResult | PowerFailure | NotImplemented>;
		sleepPrevent: (
			args: SleepPreventArgs,
		) => Promise<SleepPreventResult | PowerFailure | NotImplemented>;
		sleepAllow: () => Promise<SleepAllowResult | PowerFailure | NotImplemented>;
	}
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
		},
	});
}

/** The default registration: honest about the missing framework. */
export const powerPlugin = createPowerPlugin();
