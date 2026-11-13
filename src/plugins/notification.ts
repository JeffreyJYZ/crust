/**
 * `crust:notification` — user notifications.
 *
 * The plugin owns no framework. It takes the native half as a `post` adapter,
 * so macOS supplies `darwinNotificationAdapter()` from
 * `platform/darwin/notifications.ts` and a platform without a notification
 * center keeps answering with a typed `NotImplemented`.
 *
 * The one rule this file exists to enforce: **`delivered` is true only when the
 * OS said it accepted the notification.** An adapter answers with a `status`
 * and a `reason`; status `0` is the only one that maps to `delivered: true`, and
 * every other status is passed on as `delivered: false` with the reason intact.
 * A missing permission is therefore never a silent success.
 */

import { definePlugin, notImplemented, type NotImplemented, type PluginDefinition } from "./define";

export type NotificationPermission = "granted" | "denied" | "unknown";

export interface NotifyOptions {
	title: string;
	body?: string;
	/** Caller-chosen dedupe key. */
	id?: string;
}

/**
 * What `notify` answers.
 *
 * `delivered` is the OS's word, not the adapter's optimism: it is true only for
 * status 0, and `reason` always says which center ran and what it reported.
 */
export interface NotifyResult {
	delivered: boolean;
	reason: string;
}

/** What an adapter reports. `status` 0 is the only delivered value. */
export interface NotificationPost {
	status: number;
	reason: string;
}

/**
 * The native half of `crust:notification`.
 *
 * `post` is called for one notification and answers with the OS's own status:
 * `0` delivered, `1` authorization pending or denied, `2` a class or selector is
 * missing, `3` the API returned an error. The numbers are
 * `NOTIFICATION_STATUS` in `platform/darwin/notifications.ts`.
 */
export interface NotificationAdapter {
	post(options: NotifyOptions): NotificationPost | Promise<NotificationPost>;
}

/**
 * The pre-adapter contract, kept because it is published.
 *
 * An adapter that only knows `notify` has no way to report an OS delivery
 * status, so its own success object is passed through unchanged rather than
 * dressed up as `{ delivered, reason }`. Implement {@link NotificationAdapter}
 * instead.
 *
 * @deprecated implement `NotificationAdapter.post`
 */
export interface NotificationNative {
	requestPermission(): Promise<NotificationPermission>;
	notify(options: NotifyOptions): Promise<NotifyHandle>;
}

/** The success object the deprecated adapter contract answers with. */
export interface NotifyHandle {
	id: string;
}

/** `NOTIFICATION_STATUS.delivered` in `platform/darwin/notifications.ts`. */
const DELIVERED_STATUS = 0;

/** A `post`-shaped adapter, as opposed to the deprecated `notify` one. */
function isPostAdapter(
	adapter: NotificationAdapter | NotificationNative,
): adapter is NotificationAdapter {
	return typeof (adapter as NotificationAdapter).post === "function";
}

export function createNotificationPlugin(
	adapter?: NotificationAdapter | NotificationNative,
): PluginDefinition<
	"notification",
	{
		requestPermission: () => Promise<NotificationPermission | NotImplemented>;
		notify: (options: NotifyOptions) => Promise<NotifyResult | NotifyHandle | NotImplemented>;
	}
> {
	const missing = (command: string) =>
		notImplemented(
			`notification.${command} needs a notification center: UNUserNotificationCenter needs a bundle identifier, and the deprecated NSUserNotification has no -setTitle: on macOS 27, so an unbundled process cannot deliver. Pass a NotificationAdapter to createNotificationPlugin when one is reachable.`,
			"UNUserNotificationCenter",
		);

	return definePlugin({
		name: "notification",
		commands: {
			/**
			 * There is no synchronous way to ask for the authorization state:
			 * `UNUserNotificationCenter` answers only through a completion handler,
			 * which the native unit consumes inside `post`. So a real adapter has no
			 * separate probe, and saying so is the honest answer rather than
			 * inventing a "granted" that was never read.
			 */
			requestPermission: async (): Promise<NotificationPermission | NotImplemented> => {
				if (!adapter) return missing("requestPermission");
				if (isPostAdapter(adapter)) {
					return notImplemented(
						"notification.requestPermission: authorization is requested by notification.notify itself, and the OS answers only through a completion handler. There is no separate probe to report.",
						"UNUserNotificationCenter",
					);
				}
				return adapter.requestPermission();
			},
			notify: async (
				options: NotifyOptions,
			): Promise<NotifyResult | NotifyHandle | NotImplemented> => {
				if (!adapter) return missing("notify");
				if (typeof options?.title !== "string" || options.title.length === 0) {
					throw new TypeError('notification.notify: "title" must be a non-empty string');
				}
				if (isPostAdapter(adapter)) {
					const post = await adapter.post(options);
					return { delivered: post.status === DELIVERED_STATUS, reason: post.reason };
				}
				// The deprecated contract has no status to interpret; pass its own
				// answer through instead of claiming a delivery nobody reported.
				return adapter.notify(options);
			},
		},
	});
}

/** The default registration: honest about the missing framework. */
export const notificationPlugin = createNotificationPlugin();
