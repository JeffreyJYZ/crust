/**
 * The push half of `crust:power`: one path for both subscribe commands. Kept out of the command map
 * so the plugin stays a thin declaration, and so a platform with no notification refuses by name
 * rather than installing a listener that would never fire.
 */

import { notImplemented, type NotImplemented, type PluginContext } from "./define";
import {
	POWER_EVENTS,
	type PowerAdapter,
	type PowerEventPayload,
	type PowerFailure,
	type PowerSubscribeResult,
} from "./power-types";

const message = (error: unknown): string =>
	error instanceof Error ? error.message : String(error);

/** No OS notification means no observer is installed: a listener that never fires is worse. */
const noNotification = (command: string, requires: string): NotImplemented =>
	notImplemented(
		`power.${command} needs ${requires}; this platform has no such notification, ` +
			"so no listener was installed.",
		requires,
	);

/**
 * Register the native observer, then emit on every report. The adapter may be absent or lack the
 * method entirely; either way the refusal names the notification the caller needs.
 */
export async function subscribe(
	adapter: PowerAdapter | undefined,
	command: "onSleep" | "onLock",
	kind: keyof typeof POWER_EVENTS,
	requires: string,
	ctx: PluginContext,
): Promise<PowerSubscribeResult | PowerFailure | NotImplemented> {
	const register = adapter?.[command];
	if (typeof register !== "function") return noNotification(command, requires);
	const payload: PowerEventPayload = { kind };
	try {
		const watching = await register.call(adapter, () => {
			try {
				ctx.emit(POWER_EVENTS[kind], payload);
			} catch {
				// A page handler that throws must not unwind into the native notification callback.
			}
		});
		return watching
			? { ok: true, event: POWER_EVENTS[kind] }
			: {
					ok: false,
					code: "handler-error",
					message: `power.${command}: the OS has no ${requires} notification`,
				};
	} catch (error) {
		return { ok: false, code: "handler-error", message: message(error) };
	}
}
