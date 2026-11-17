/**
 * A recording fake for `crust:power`, shared by the two suites so the notification callback has one
 * home. It registers the listener the subscribe commands hand it, so a test can fire the way the OS
 * would — no notification center, observer object or JSCallback is ever built.
 */

import type { PluginContext } from "./define";
import type { PowerAdapter } from "./power-types";

export interface RecordedPower {
	adapter: PowerAdapter;
	/** Every adapter method the plugin called, in order. */
	calls: string[];
	/** Fire the listener `onSleep` registered, as the OS would. */
	fireSleep(): void;
	/** Fire the listener `onLock` registered, as the OS would. */
	fireLock(): void;
}

export function fakePower(
	options: {
		watchSleep?: boolean;
		watchLock?: boolean;
		/** Set true to omit the notification methods entirely, as a platform without them does. */
		noNotifications?: boolean;
	} = {},
): RecordedPower {
	const calls: string[] = [];
	let sleep: (() => void) | undefined;
	let lock: (() => void) | undefined;
	const adapter: PowerAdapter = {
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
		...(options.noNotifications
			? {}
			: {
					onSleep: (listener) => {
						calls.push("onSleep");
						sleep = listener;
						return options.watchSleep ?? true;
					},
					onLock: (listener) => {
						calls.push("onLock");
						lock = listener;
						return options.watchLock ?? true;
					},
				}),
	};
	return {
		adapter,
		calls,
		fireSleep: () => sleep?.(),
		fireLock: () => lock?.(),
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
