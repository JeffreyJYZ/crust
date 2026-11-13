/**
 * `crust:notification` — user notifications.
 *
 * `UNUserNotificationCenter` is not reachable from `libobjc` alone and wants a
 * bundle identity (DESIGN.md §9 item 5), so the default registration returns a
 * typed `NotImplemented` rather than a fake success. The seam is a
 * `NotificationNative` adapter, passed once a framework handle exists.
 */

import { definePlugin, notImplemented, type NotImplemented, type PluginDefinition } from "./define";

export type NotificationPermission = "granted" | "denied" | "unknown";

export interface NotifyOptions {
	title: string;
	body?: string;
	/** Caller-chosen dedupe key. */
	id?: string;
}

export interface NotifyResult {
	id: string;
}

export interface NotificationNative {
	requestPermission(): Promise<NotificationPermission>;
	notify(options: NotifyOptions): Promise<NotifyResult>;
}

export function createNotificationPlugin(native?: NotificationNative): PluginDefinition<
	"notification",
	{
		requestPermission: () => Promise<NotificationPermission | NotImplemented>;
		notify: (options: NotifyOptions) => Promise<NotifyResult | NotImplemented>;
	}
> {
	const missing = (command: string) =>
		notImplemented(
			`notification.${command} needs UNUserNotificationCenter, which is not reachable from libobjc and needs a bundle identity. Pass a NotificationNative adapter to createNotificationPlugin once the framework handle exists.`,
			"UNUserNotificationCenter",
		);

	return definePlugin({
		name: "notification",
		commands: {
			requestPermission: async (): Promise<NotificationPermission | NotImplemented> => {
				if (!native) return missing("requestPermission");
				return native.requestPermission();
			},
			notify: async (options: NotifyOptions): Promise<NotifyResult | NotImplemented> => {
				if (!native) return missing("notify");
				if (typeof options?.title !== "string" || options.title.length === 0) {
					throw new TypeError('notification.notify: "title" must be a non-empty string');
				}
				return native.notify(options);
			},
		},
	});
}

/** The default registration: honest about the missing framework. */
export const notificationPlugin = createNotificationPlugin();
