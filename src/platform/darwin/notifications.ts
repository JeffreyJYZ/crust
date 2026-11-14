/**
 * macOS notifications: `UNUserNotificationCenter` first, the deprecated
 * `NSUserNotificationCenter` second.
 *
 * The native half lives in `notifications/*.c`, one translation unit
 * concatenated and compiled by `notifications-ffi.ts`, and it obeys the same
 * four rules as the shim (DESIGN.md §2): a fixed prototype per `objc_msgSend`,
 * no framework headers, no struct across `bun:ffi`, and the title and body
 * crossing as encoded buffers rather than objects.
 *
 * Two facts are measured on this machine and they decide which path runs:
 *
 *   - `objc_getClass("UNUserNotificationCenter")` resolves once
 *     `-framework UserNotifications` is linked, and `-framework` is mandatory:
 *     linking is what makes the class visible at all.
 *   - `-[NSBundle bundleIdentifier]` is `nil` in an unbundled `bun` process, and
 *     that is the exact condition under which `+currentNotificationCenter`
 *     raises `NSInternalInconsistencyException`. An ObjC exception is a SIGABRT
 *     with no JavaScript error, so the C unit refuses to send that selector
 *     without an identifier and falls back.
 *
 * `runtime.ts` wires `darwinNotificationAdapter()` into
 * `createNotificationPlugin` on macOS (`nativePlugins`); `postNotification`
 * stays exported for a caller that wants the post without the plugin.
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
	 * How long to let the system permission prompt stay up, in milliseconds.
	 *
	 * A first post triggers that prompt, and the OS answers nothing until a human clicks.
	 * The old fixed wait was 1500 ms — shorter than reading the dialog — so a first
	 * `notify` always answered "not answered yet". 0 asks without waiting; the ceiling is
	 * 120 s because this wait blocks the invoke.
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
 * Compile the C unit and report whether every export resolved.
 *
 * `cc()` refuses a declared symbol it cannot find, so a successful compile is
 * the proof that all three functions exist. Nothing is posted, so this is safe
 * to call in a test and needs no notification permission.
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
 * Post one local notification.
 *
 * Never throws: a compile failure is a status like any other, so a caller on a
 * machine where the unit will not build gets a reason to report instead of an
 * exception. `status` is 0 only when the OS accepted the notification, which on
 * this machine means the deprecated center, because an unbundled process has no
 * bundle identifier and `UNUserNotificationCenter` is never entered.
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
