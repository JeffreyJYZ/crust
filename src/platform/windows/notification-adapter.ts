/**
 * The native half of `crust:notification` on Windows: a balloon, through the notification-area icon.
 *
 * **Why a balloon and not a toast.** A real toast needs `Windows.UI.Notifications` and a registered
 * AppUserModelID, which means a Start-menu shortcut and a COM activation server — neither of which a
 * `bun:ffi` process can register, and an unregistered toast is silently dropped. `Shell_NotifyIconW`
 * with `NIF_INFO` is the one mechanism that needs no registration, so it is the mechanism here: a
 * balloon on the icon `tray` also uses, in `60_notify_tray.c`.
 *
 * **`requestPermission` has no equivalent.** Windows has no notification authorization model: there
 * is no consent to ask for, and nothing reports a permission state, so the honest answer is that
 * nothing gates delivery. The plugin only calls it on the deprecated adapter contract; it is exposed
 * here so a caller can see the truth rather than a `notImplemented` borrowed from macOS.
 *
 * UNPROVEN ON WINDOWS — written on macOS. The shape, the status mapping and every refusal are
 * measured through `notify-tray-fake.ts`; the Win32 calls are not.
 */
import type {
	NotificationAdapter,
	NotificationPermission,
	NotifyOptions,
	NotificationPost,
} from "@/plugins/notification";
import { cstring } from "./cstring.ts";
import { type WindowsNotifyTrayShim, notifyTrayShim } from "./notify-tray-ffi.ts";

/** What `shim_notify_post` answers, named so the mapping below reads as answers. */
export const NOTIFY_STATUS = {
	/** `Shell_NotifyIconW(NIM_MODIFY, NIF_INFO)` returned TRUE: the shell queued it. */
	delivered: 0,
	/** A Win32 entry point did not resolve, so no balloon can be posted at all. */
	missing: 2,
	/** The shell refused the call. */
	refused: 3,
	/** There is no notification area, so there is no icon for a balloon to hang from. */
	noTray: 4,
} as const;

/** The one sentence `requestPermission` stands behind on this platform. */
export const NO_PERMISSION_MODEL =
	"Windows has no notification authorization model: there is no consent to request and no state to read, so nothing gates delivery";

/** The plugin's `NotificationAdapter`, plus the truthful permission answer. */
export interface WindowsNotificationAdapter extends NotificationAdapter {
	requestPermission(): NotificationPermission;
}

export interface WindowsNotificationOptions {
	/** The unit to call; defaults to compiling the shipped one on first use. */
	shim?: () => WindowsNotifyTrayShim | undefined;
}

export function windowsNotificationAdapter(
	options: WindowsNotificationOptions = {},
): WindowsNotificationAdapter {
	const shimOf =
		options.shim ??
		(() => {
			try {
				return notifyTrayShim();
			} catch {
				// A machine where TinyCC cannot build the unit is a status, never a throw: the plugin's
				// `post` contract has no exception path, and a caller must see why nothing was shown.
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
					reason: "the notification C unit could not be compiled, so no balloon was posted",
				};
			}
			const title = typeof note?.title === "string" ? note.title : "";
			const body = typeof note?.body === "string" ? note.body : "";
			const status = Number(shim.shim_notify_post(cstring(title), cstring(body)) ?? -1);
			const said = String(shim.shim_notify_reason() ?? "");
			return { status, reason: said.length > 0 ? said : `status ${status} with no reason` };
		},
	};
}
