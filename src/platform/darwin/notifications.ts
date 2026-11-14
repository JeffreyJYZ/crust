/**
 * macOS notifications: `UNUserNotificationCenter` first, the deprecated `NSUserNotificationCenter` second. The native half is `notifications/*.c`, concatenated and compiled by `notifications-ffi.ts`, obeying the shim's four rules (the design page (`site/app/docs/design/page.mdx`)): fixed prototype per `objc_msgSend`, no framework headers, no struct across `bun:ffi`, title and body as encoded buffers.
 * Two measured facts decide the path: `objc_getClass("UNUserNotificationCenter")` resolves only once `-framework UserNotifications` is linked; and `-[NSBundle bundleIdentifier]` is `nil` in an unbundled `bun` process, exactly when `+currentNotificationCenter` raises `NSInternalInconsistencyException` — a SIGABRT with no JavaScript error, so the C unit refuses that selector without an identifier and falls back. `runtime.ts` wires `darwinNotificationAdapter()` in via `nativePlugins`.
 */

import type { NotificationAdapter } from "@/plugins/notification";
import { cbuf, message, type NotificationUnit, unit } from "./notifications-ffi";

/**
 * The status codes the C unit returns. `delivered` is the only one that means
 * the OS accepted the notification; the plugin maps it to `delivered: true`.
 */
export const NOTIFICATION_STATUS = {
	/** The OS accepted the notification and reported no error. */
	delivered: 0,
	/** Authorization is pending or was denied: nothing was delivered. */
	authorization: 1,
	/** A class or selector is missing, or neither center is reachable. */
	missing: 2,
	/** The API answered with an error. */
	error: 3,
} as const;

export interface PostNotificationOptions {
	title: string;
	body?: string;
	/**
	 * How long to let the system permission prompt stay up, in milliseconds. A first post triggers it and the OS answers nothing until a human clicks; the old fixed 1500 ms was shorter than reading the dialog, so a first `notify` always answered "not answered yet". 0 asks without waiting, and the 120 s ceiling is because this blocks the invoke.
	 */
	waitMs?: number;
}

export interface PostNotificationResult {
	/** One of `NOTIFICATION_STATUS`. */
	status: number;
	/** Why the last post ended as it did, including which center ran. */
	reason: string;
}

/**
 * Compile the C unit and report whether every export resolved. `cc()` refuses a declared symbol it cannot find, so a successful compile proves all three functions exist. Nothing is posted, so this is test-safe and needs no permission.
 */
export function notificationUnitStatus(): { available: boolean; reason: string } {
	try {
		unit();
		return { available: true, reason: "compiled" };
	} catch (error) {
		return { available: false, reason: message(error) };
	}
}

/**
 * Post one local notification. Never throws: a compile failure is a status like any other, so a caller on a machine where the unit will not build gets a reason instead of an exception. `status` is 0 only when the OS accepted it — on this machine that means the deprecated center, because an unbundled process has no bundle identifier and `UNUserNotificationCenter` is never entered.
 */
export function postNotification(options: PostNotificationOptions): PostNotificationResult {
	const title = typeof options?.title === "string" ? options.title : "";
	const body = typeof options?.body === "string" ? options.body : "";
	if (title.length === 0) {
		return {
			status: NOTIFICATION_STATUS.error,
			reason: 'postNotification: "title" must be a non-empty string',
		};
	}

	let compiled: NotificationUnit;
	try {
		compiled = unit();
	} catch (error) {
		return {
			status: NOTIFICATION_STATUS.missing,
			reason: `the notification C unit did not compile: ${message(error)}`,
		};
	}

	const asked = options?.waitMs;
	const waitMs =
		typeof asked === "number" && Number.isFinite(asked)
			? Math.max(0, Math.min(120_000, Math.trunc(asked)))
			: 1500;
	const status = Number(
		compiled.symbols.crust_notification_post(cbuf(title), cbuf(body), waitMs) ?? -1,
	);
	const reason = String(compiled.symbols.crust_notification_reason() ?? "");
	return {
		status,
		reason: reason.length > 0 ? reason : `status ${status} with no recorded reason`,
	};
}

/**
 * The native half of `crust:notification`.
 *
 * Built here rather than in `platform/darwin/index.ts` because it is its own C
 * unit with its own framework; nothing in the window shim knows about it.
 */
export function darwinNotificationAdapter(): NotificationAdapter {
	return { post: (options) => postNotification(options) };
}
