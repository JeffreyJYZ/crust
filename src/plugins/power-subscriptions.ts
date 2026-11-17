/**
 * The six push events of `crust:power` as one table: the command a page invokes, the event it arms,
 * and the OS notification it needs. Kept out of the plugin so a new push event is a row here rather
 * than another copy of the same handler, and so every refusal names the notification the platform is
 * missing.
 */

import type { NotImplemented, PluginContext } from "./define";
import type {
	PowerAdapter,
	PowerEventKind,
	PowerFailure,
	PowerSubscribeCommand,
	PowerSubscribeResult,
} from "./power-types";
import { subscribe } from "./power-subscribe.ts";

export interface PowerSubscription {
	command: PowerSubscribeCommand;
	kind: PowerEventKind;
	/** The notification, or the distributed one for the lock pair, that the platform must post. */
	requires: string;
}

export const POWER_SUBSCRIPTIONS = [
	{ command: "onSleep", kind: "sleep", requires: "NSWorkspaceWillSleepNotification" },
	{ command: "onLock", kind: "lock", requires: "com.apple.screenIsLocked" },
	{ command: "onWake", kind: "wake", requires: "NSWorkspaceDidWakeNotification" },
	{
		command: "onScreenSleep",
		kind: "screensleep",
		requires: "NSWorkspaceScreensDidSleepNotification",
	},
	{
		command: "onScreenWake",
		kind: "screenwake",
		requires: "NSWorkspaceScreensDidWakeNotification",
	},
	{ command: "onUnlock", kind: "unlock", requires: "com.apple.screenIsUnlocked" },
] as const satisfies ReadonlyArray<PowerSubscription>;

export type PowerSubscribeHandler = (
	args: unknown,
	ctx: PluginContext,
) => Promise<PowerSubscribeResult | PowerFailure | NotImplemented>;

/** The six commands in declaration order, so a test never restates the list. */
export const POWER_PUSH_COMMANDS = POWER_SUBSCRIPTIONS.map((row) => row.command);

/** Every subscribe command as its own handler, built from the table above. */
export type PowerSubscribeHandlers = Record<PowerSubscribeCommand, PowerSubscribeHandler>;

export function powerSubscribeHandlers(adapter?: PowerAdapter): PowerSubscribeHandlers {
	const handlers = POWER_SUBSCRIPTIONS.map(
		({ command, kind, requires }) =>
			[
				command,
				(_args: unknown, ctx: PluginContext) =>
					subscribe(adapter, command, kind, requires, ctx),
			] as const,
	);
	return Object.fromEntries(handlers) as PowerSubscribeHandlers;
}
