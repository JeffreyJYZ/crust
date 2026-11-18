/**
 * `notification` and `tray` through the registry, which is how `MATRIX.md` measured them: build the
 * plugin set the OS would get, with the real `corePlugins`, and call the commands a page would call.
 *
 * The real core list matters: it carries the bare `notification` and `tray`, and the registry refuses
 * a duplicate name rather than shadowing one, so a passing answer is also proof that the adapted
 * plugin replaced the bare one and that exactly one of each is registered.
 *
 * Measured on this macOS machine, and that is the point — neither the Win32 nor the GTK library can
 * exist here, so both arms answer a named refusal instead of showing anything. Before this wiring the
 * same calls answered `not-implemented` naming `NSStatusBar` and `UNUserNotificationCenter`; no
 * notification is posted here either, because each unit names the library it could not resolve.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { activeLinuxTray, setActiveLinuxTray } from "@/platform/linux/tray-tick";
import { activeWindowsTray, setActiveWindowsTray } from "@/platform/windows/tray-tick";
import { corePlugins } from "@/plugins/core";
import type { PluginDefinition } from "@/plugins/define";
import { nativePlugins } from "@/runtime-plugins.ts";

type Commands = Record<string, (args: unknown) => unknown>;

/** The commands of one registered plugin, by name, out of the set `corePlugins` produces. */
async function commandsOf(os: string, name: string): Promise<Commands> {
	const plugins = await nativePlugins(corePlugins, undefined, { app: "land.jyz.notify" }, os);
	const plugin = plugins.find((entry: PluginDefinition) => entry.name === name);
	if (plugin === undefined) throw new Error(`${name} is not registered for ${os}`);
	return plugin.commands as unknown as Commands;
}

afterEach(() => {
	setActiveWindowsTray(undefined);
	setActiveLinuxTray(undefined);
});

describe("notification and tray answer from the platform adapter", () => {
	test("win32: tray.setTitle is the Windows refusal, not the AppKit one", async () => {
		const tray = await commandsOf("win32", "tray");
		const answer = tray.setTitle?.({ text: "crust" }) as { ok: false; message: string };
		expect(answer.ok).toBe(false);
		expect(answer.message).toContain("notification-area icon has no text label");
		expect(answer.message).not.toContain("NSStatusBar");
	});

	test("win32: notification.notify reports a status, never a missing center", async () => {
		const notification = await commandsOf("win32", "notification");
		const answer = (await notification.notify?.({ title: "probe" })) as {
			delivered: boolean;
			reason: string;
		};
		expect(answer.delivered).toBe(false);
		expect(answer.reason).not.toContain("UNUserNotificationCenter");
	});

	test("linux: tray.setTitle is the GTK refusal, not the AppKit one", async () => {
		const tray = await commandsOf("linux", "tray");
		const answer = tray.setTitle?.({ text: "crust" }) as { ok: false; message: string };
		expect(answer.ok).toBe(false);
		expect(answer.message).toContain("GtkStatusIcon has no text label");
		expect(answer.message).not.toContain("NSStatusBar");
	});

	test("linux: notification.notify names libnotify, not UNUserNotificationCenter", async () => {
		const notification = await commandsOf("linux", "notification");
		const answer = (await notification.notify?.({ title: "probe" })) as {
			delivered: boolean;
			reason: string;
		};
		expect(answer.delivered).toBe(false);
		expect(answer.reason).not.toContain("UNUserNotificationCenter");
	});

	/** Without this slot the pump has nothing to poll, which is the click-relay bug in one line. */
	test("each arm hands its tray to the pump", async () => {
		setActiveWindowsTray(undefined);
		setActiveLinuxTray(undefined);
		await nativePlugins(corePlugins, undefined, { app: "land.jyz.notify" }, "win32");
		expect(activeWindowsTray()).toBeDefined();
		expect(activeLinuxTray()).toBeUndefined();
		await nativePlugins(corePlugins, undefined, { app: "land.jyz.notify" }, "linux");
		expect(activeLinuxTray()).toBeDefined();
	});
});
