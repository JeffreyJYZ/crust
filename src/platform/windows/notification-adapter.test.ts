/**
 * `crust:notification` on Windows, through the real plugin and a fake symbol table.
 *
 * Nothing here posts a balloon: that needs a notification area and a human to see it, so what is
 * proven is the mapping the plugin owns — status 0 is the only `delivered: true` — and that every
 * refusal arrives as a reason instead of an exception.
 */
import { describe, expect, test } from "bun:test";
import { createNotificationPlugin } from "@/plugins/notification";
import {
	NO_PERMISSION_MODEL,
	NOTIFY_STATUS,
	windowsNotificationAdapter,
} from "./notification-adapter.ts";
import { fakeNotifyTray } from "./notify-tray-fake.ts";

const plugin = (options: Parameters<typeof fakeNotifyTray>[0] = {}, calls: string[] = []) =>
	createNotificationPlugin(
		windowsNotificationAdapter({ shim: () => fakeNotifyTray(options, calls) }),
	);

describe("notification.notify on Windows", () => {
	test("a queued balloon is the only delivered answer", async () => {
		const result = await plugin({ postStatus: NOTIFY_STATUS.delivered }).commands.notify({
			title: "Build finished",
			body: "3 tests passed",
		});
		expect(result).toEqual({
			delivered: true,
			reason: "the shell accepted it",
		});
	});

	test("a refused call is delivered: false with the shell's own reason", async () => {
		const result = await plugin({
			postStatus: NOTIFY_STATUS.refused,
			reason: "Shell_NotifyIconW(NIM_MODIFY, NIF_INFO) returned FALSE",
		}).commands.notify({ title: "Build failed" });
		expect(result).toEqual({
			delivered: false,
			reason: "Shell_NotifyIconW(NIM_MODIFY, NIF_INFO) returned FALSE",
		});
	});

	test("no notification area is delivered: false, never a silent success", async () => {
		const result = await plugin({
			postStatus: NOTIFY_STATUS.noTray,
			reason: "Shell_NotifyIconW(NIM_ADD) returned FALSE — no notification area",
		}).commands.notify({ title: "x" });
		expect(result).toEqual({
			delivered: false,
			reason: "Shell_NotifyIconW(NIM_ADD) returned FALSE — no notification area",
		});
	});

	test("the title and body reach C byte-exact, NUL-terminated", async () => {
		const calls: string[] = [];
		await plugin({}, calls).commands.notify({ title: "Ünïcode ✓", body: "line one" });
		expect(calls).toContain("post:Ünïcode ✓:line one");
	});

	test("a unit that will not compile is a status, not a throw", async () => {
		const adapter = windowsNotificationAdapter({ shim: () => undefined });
		const result = await createNotificationPlugin(adapter).commands.notify({ title: "x" });
		expect(result).toEqual({
			delivered: false,
			reason: "the notification C unit could not be compiled, so no balloon was posted",
		});
	});

	test("the plugin still refuses an empty title before the adapter is reached", async () => {
		const calls: string[] = [];
		await expect(plugin({}, calls).commands.notify({ title: "" })).rejects.toThrow(TypeError);
		expect(calls).toEqual([]);
	});
});

describe("notification.requestPermission on Windows", () => {
	/**
	 * There is no Windows equivalent to ask: no consent gates a balloon, and no API reports a state.
	 * `granted` is that fact — a caller branching on it proceeds, which is the correct behaviour —
	 * and the sentence it stands behind is exported so nothing has to infer it.
	 */
	test("answers granted, and says why there was nothing to ask", () => {
		expect(
			windowsNotificationAdapter({ shim: () => fakeNotifyTray() }).requestPermission(),
		).toBe("granted");
		expect(NO_PERMISSION_MODEL).toContain("no notification authorization model");
		expect(NO_PERMISSION_MODEL).toContain("nothing gates delivery");
	});
});
