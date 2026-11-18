/**
 * `crust:notification` on Linux, through the real plugin and a fake symbol table.
 *
 * Nothing here reaches a session bus: what is proven is the mapping the plugin owns — status 0 is the
 * only `delivered: true` — that a `GError` message arrives as the reason, and that a machine without
 * libnotify is a refusal naming the library rather than a silent success.
 */
import { describe, expect, test } from "bun:test";
import { createNotificationPlugin } from "@/plugins/notification";
import {
	linuxNotificationAdapter,
	NO_PERMISSION_MODEL,
	NOTIFY_STATUS,
} from "./notification-adapter.ts";
import { fakeNotifyTray, type FakeNotifyTrayOptions } from "./notify-tray-fake.ts";

const built = (options: FakeNotifyTrayOptions = {}, calls: string[] = []) => {
	const fake = fakeNotifyTray(options, calls);
	return {
		fake,
		calls,
		plugin: createNotificationPlugin(linuxNotificationAdapter({ shim: () => fake })),
	};
};

describe("notification.notify on Linux", () => {
	test("a notification the daemon accepted is the only delivered answer", async () => {
		const result = await built({ postStatus: NOTIFY_STATUS.delivered }).plugin.commands.notify({
			title: "Build finished",
			body: "3 tests passed",
		});
		expect(result).toEqual({ delivered: true, reason: "the daemon accepted it" });
	});

	test("a refused notification carries libnotify's own GError message", async () => {
		const result = await built({
			postStatus: NOTIFY_STATUS.refused,
			reason: "notify_notification_show returned FALSE: Could not connect: No such file or directory",
		}).plugin.commands.notify({ title: "Build failed" });
		expect(result).toEqual({
			delivered: false,
			reason: "notify_notification_show returned FALSE: Could not connect: No such file or directory",
		});
	});

	test("a missing library is named, never dressed up as a delivery", async () => {
		const result = await built({
			postStatus: NOTIFY_STATUS.missing,
			missing: "libnotify.so.4",
		}).plugin.commands.notify({ title: "x" });
		expect(result).toEqual({ delivered: false, reason: "libnotify.so.4 did not resolve" });
	});

	test("the title and body reach C byte-exact", async () => {
		const { plugin, calls } = built();
		await plugin.commands.notify({ title: "Ünïcode ✓", body: "line one" });
		expect(calls).toContain("post:Ünïcode ✓:line one");
	});

	test("a unit that will not compile is a status, not a throw", async () => {
		const adapter = linuxNotificationAdapter({ shim: () => undefined });
		const result = await createNotificationPlugin(adapter).commands.notify({ title: "x" });
		expect(result).toEqual({
			delivered: false,
			reason: "the notification C unit could not be compiled, so nothing was sent",
		});
	});
});

describe("the adapter's own members", () => {
	test("requestPermission answers granted, and says why there was nothing to ask", () => {
		expect(built().fake.shim_notify_ready()).toBe(1);
		expect(linuxNotificationAdapter({ shim: () => fakeNotifyTray() }).requestPermission()).toBe(
			"granted",
		);
		expect(NO_PERMISSION_MODEL).toContain("no notification authorization model");
	});

	/** The plugin has no dismiss member, so this is the caller's: it closes what it last posted. */
	test("close dismisses the last notification and answers whether one was showing", () => {
		const { fake, calls } = built({ closeResult: 1 });
		const adapter = linuxNotificationAdapter({ shim: () => fake });
		expect(adapter.close()).toBe(true);
		expect(calls).toContain("notify_close");
	});

	test("close answers false when there is no unit to ask", () => {
		expect(linuxNotificationAdapter({ shim: () => undefined }).close()).toBe(false);
	});
});
