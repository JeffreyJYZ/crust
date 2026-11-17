/**
 * A recording fake for `crust:power`, shared by the suites so the notification callbacks have one
 * home. It registers the listeners the subscribe commands hand it, so a test can fire the way the OS
 * would — no notification center, observer object or JSCallback is ever built.
 */

import type { PluginContext } from "./define";
import type { PowerAdapter } from "./power-types";

/** Every push event the fake can drive, keyed by the adapter method that arms it. */
const PUSH_COMMANDS = [
	"onSleep",
	"onLock",
	"onWake",
	"onScreenSleep",
	"onScreenWake",
	"onUnlock",
] as const;

export type PowerPushCommand = (typeof PUSH_COMMANDS)[number];

export interface RecordedPower {
	adapter: PowerAdapter;
	/** Every adapter method the plugin called, in order. */
	calls: string[];
	/** Fire the listener that command registered, as the OS would. */
	fire(command: PowerPushCommand): void;
	/** Fire the listener `onSleep` registered. */
	fireSleep(): void;
	/** Fire the listener `onLock` registered. */
	fireLock(): void;
}

export function fakePower(
	options: {
		/** Which push commands report a refusal instead of an armed observer. */
		unwatched?: readonly PowerPushCommand[];
		/** Set true to omit the notification methods entirely, as a platform without them does. */
		noNotifications?: boolean;
	} = {},
): RecordedPower {
	const calls: string[] = [];
	const listeners = new Map<PowerPushCommand, () => void>();
	const base: PowerAdapter = {
		state: () => ({ onAc: true, batteryPercent: 87, lowPowerMode: false }),
		idleSeconds: () => 12.5,
		preventSleep: (reason) => {
			calls.push(`prevent:${reason}`);
			return { ok: true, id: 1, reason: "assertion held" };
		},
		allowSleep: () => {
			calls.push("allow");
			return { ok: true, released: true, reason: "assertion released" };
		},
	};
	const optional: Partial<PowerAdapter> = {};
	if (!options.noNotifications) {
		for (const command of PUSH_COMMANDS) {
			optional[command] = (listener: () => void) => {
				calls.push(command);
				listeners.set(command, listener);
				return !(options.unwatched ?? []).includes(command);
			};
		}
	}
	const adapter: PowerAdapter = { ...base, ...optional };
	return {
		adapter,
		calls,
		fire: (command) => listeners.get(command)?.(),
		fireSleep: () => listeners.get("onSleep")?.(),
		fireLock: () => listeners.get("onLock")?.(),
	};
}

/** A context that records what a command pushed. */
export function collector(): {
	events: Array<{ event: string; data: unknown }>;
	ctx: PluginContext;
} {
	const events: Array<{ event: string; data: unknown }> = [];
	return { events, ctx: { emit: (event, data) => events.push({ event, data }) } };
}
