/**
 * The native half of `crust:notification` on Linux: libnotify, in `80_notify.c`.
 *
 * **Why libnotify and not the D-Bus method.** `notify_notification_show` marshals
 * `org.freedesktop.Notifications.Notify` — including its `susssasa{sv}i` signature — itself. Building
 * that variant dictionary by hand would be a second marshalling layer written blind on a machine with
 * no session bus, so libnotify is the mechanism and a machine without it gets a refusal naming
 * `libnotify.so.4` rather than a half-built call.
 *
 * **`requestPermission` has no equivalent.** Linux has no notification authorization model: the
 * daemon either exists on the session bus or it does not, and nothing gates delivery on consent.
 *
 * UNPROVEN ON LINUX — written on macOS. The shape, the status mapping and every refusal are measured
 * through `notify-tray-fake.ts`; the libnotify calls are not.
 */
import type {
	NotificationAdapter,
	NotificationPermission,
	NotificationPost,
	NotifyOptions,
} from "@/plugins/notification";
import { cstring } from "./cstring.ts";
import { type LinuxNotifyTrayShim, notifyTrayShim } from "./notify-tray-ffi.ts";

/** What `shim_notify_post` answers, named so the mapping reads as answers. */
export const NOTIFY_STATUS = {
	/** `notify_notification_show` returned TRUE: the daemon accepted it. */
	delivered: 0,
	/** libnotify, GLib or GObject did not resolve, so nothing can be sent at all. */
	missing: 2,
	/** libnotify or the daemon refused, with the `GError` message as the reason. */
	refused: 3,
} as const;

/** The one sentence `requestPermission` stands behind on this platform. */
export const NO_PERMISSION_MODEL =
	"Linux has no notification authorization model: the daemon is either on the session bus or it is not, and nothing gates delivery on consent";

/** The plugin's `NotificationAdapter`, plus the truthful permission answer and a dismiss. */
export interface LinuxNotificationAdapter extends NotificationAdapter {
	requestPermission(): NotificationPermission;
	/** Dismiss the notification this adapter last posted; the plugin has no member for it. */
	close(): boolean;
}

export interface LinuxNotificationOptions {
	/** The unit to call; defaults to compiling the shipped one on first use. */
	shim?: () => LinuxNotifyTrayShim | undefined;
}

export function linuxNotificationAdapter(
	options: LinuxNotificationOptions = {},
): LinuxNotificationAdapter {
	const shimOf =
		options.shim ??
		(() => {
			try {
				return notifyTrayShim();
			} catch {
				// A machine where TinyCC cannot build the unit is a status, never a throw: `post` has
				// no exception path and a caller must see why nothing was shown.
				return undefined;
			}
		});

	return {
		requestPermission: () => "granted",

		post: (note: NotifyOptions): NotificationPost => {
			const shim = shimOf();
			if (shim === undefined) {
				return {
					status: NOTIFY_STATUS.missing,
					reason: "the notification C unit could not be compiled, so nothing was sent",
				};
			}
			const title = typeof note?.title === "string" ? note.title : "";
			const body = typeof note?.body === "string" ? note.body : "";
			const status = Number(shim.shim_notify_post(cstring(title), cstring(body)) ?? -1);
			const said = String(shim.shim_notify_reason() ?? "");
			const missing = String(shim.shim_notify_missing() ?? "");
			const reason = missing.length > 0 ? `${missing} did not resolve` : said;
			return {
				status,
				reason: reason.length > 0 ? reason : `status ${status} with no reason`,
			};
		},

		close: (): boolean => {
			const shim = shimOf();
			return shim !== undefined && Number(shim.shim_notify_close() ?? 0) === 1;
		},
	};
}
