/**
 * `crust:notification` proofs that need no permission. Nothing here posts a real notification — that needs a human to see it — so they stop at the C unit compiling and at the mapping from an OS status to `delivered`; that nothing was proven about delivery is stated in the report rather than faked.
 */

import { describe, expect, test } from "bun:test";
import { isNotImplemented } from "@/plugins/define.ts";
import {
	createNotificationPlugin,
	type NotificationAdapter,
	notificationPlugin,
} from "@/plugins/notification.ts";
import {
	NOTIFICATION_STATUS,
	notificationUnitStatus,
	postNotification,
} from "@/platform/darwin/notifications.ts";

const darwinOnly = process.platform !== "darwin";

describe("notification C unit", () => {
	/**
	 * `cc()` refuses a symbol it cannot resolve, so a successful compile is the
	 * proof that `crust_notification_post`, `crust_notification_reason` and
	 * `crust_notification_center` all exist. Nothing is sent to the OS.
	 */
	test.skipIf(darwinOnly)("compiles through cc() and exports its symbols", () => {
		const status = notificationUnitStatus();
		expect(status.reason).toBe("compiled");
		expect(status.available).toBe(true);
	});

	test("refuses an empty title before any C call", () => {
		const result = postNotification({ title: "" });
		// This check runs in TypeScript, above the unit, so no notification is
		// ever handed to the OS for an unpostable request.
		expect(result).toEqual({
			status: NOTIFICATION_STATUS.error,
			reason: 'postNotification: "title" must be a non-empty string',
		});
	});
});

describe("notification plugin", () => {
	test("not-implemented without an adapter, naming the framework", async () => {
		const plugin = createNotificationPlugin();
		const notify = await plugin.commands.notify({ title: "x" });
		expect(isNotImplemented(notify)).toBe(true);
		if (isNotImplemented(notify)) {
			expect(notify.code).toBe("not-implemented");
			expect(notify.requires).toBe("UNUserNotificationCenter");
		}

		const permission = await plugin.commands.requestPermission();
		expect(isNotImplemented(permission)).toBe(true);
		if (isNotImplemented(permission)) {
			expect(permission.requires).toBe("UNUserNotificationCenter");
		}
	});

	test("the default registration is the adapter-less one", () => {
		expect(notificationPlugin.name).toBe("notification");
		expect(typeof notificationPlugin.commands.notify).toBe("function");
	});

	test("a refused title is a TypeError, not a posted notification", async () => {
		const seen: unknown[] = [];
		const plugin = createNotificationPlugin({
			post: (options) => {
				seen.push(options);
				return { status: 0, reason: "unreachable" };
			},
		});
		await expect(plugin.commands.notify({ title: "" })).rejects.toThrow(TypeError);
		expect(seen).toEqual([]);
	});

	test("waitMs reaches the adapter, because that wait is the whole prompt budget", async () => {
		let received: { waitMs?: number } | undefined;
		const plugin = createNotificationPlugin({
			post: (options) => {
				received = options as { waitMs?: number };
				return { status: NOTIFICATION_STATUS.authorization, reason: "not answered yet" };
			},
		});
		await plugin.commands.notify({ title: "hi", waitMs: 30_000 });
		expect(received?.waitMs).toBe(30_000);
	});

	test("a denied result maps to delivered:false and keeps the reason", async () => {
		const reason = "UNUserNotificationCenter: authorization was denied";
		const adapter: NotificationAdapter = {
			post: () => ({ status: NOTIFICATION_STATUS.authorization, reason }),
		};
		const result = await createNotificationPlugin(adapter).commands.notify({ title: "hi" });
		expect(result).toEqual({ delivered: false, reason });
	});

	test("status 0 is the only delivered:true", async () => {
		const adapter: NotificationAdapter = {
			post: () => ({ status: NOTIFICATION_STATUS.delivered, reason: "accepted" }),
		};
		const plugin = createNotificationPlugin(adapter);
		expect(await plugin.commands.notify({ title: "hi" })).toEqual({
			delivered: true,
			reason: "accepted",
		});
	});

	test("missing symbols and API errors stay delivered:false", async () => {
		for (const status of [NOTIFICATION_STATUS.missing, NOTIFICATION_STATUS.error]) {
			const adapter: NotificationAdapter = {
				post: () => ({ status, reason: `status ${status}` }),
			};
			const result = await createNotificationPlugin(adapter).commands.notify({ title: "hi" });
			expect(result).toEqual({ delivered: false, reason: `status ${status}` });
		}
	});

	test("a real adapter has no separate permission probe and says so", async () => {
		const adapter: NotificationAdapter = {
			post: () => ({ status: NOTIFICATION_STATUS.delivered, reason: "accepted" }),
		};
		const permission = await createNotificationPlugin(adapter).commands.requestPermission();
		expect(isNotImplemented(permission)).toBe(true);
	});

	test("the plugin takes an async adapter too", async () => {
		const adapter: NotificationAdapter = {
			post: async () => ({ status: NOTIFICATION_STATUS.authorization, reason: "pending" }),
		};
		expect(await createNotificationPlugin(adapter).commands.notify({ title: "hi" })).toEqual({
			delivered: false,
			reason: "pending",
		});
	});
});
