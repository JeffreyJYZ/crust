/**
 * The namespaces a normal app hits in its first hour — `clipboard`, `opener`, `os.info`, and the
 * `notification` + `tray` pair — registered with the platform's own adapter instead of the bare
 * refusal.
 *
 * Kept apart from `runtime-plugins-other.ts` because that file carries every lane's registration and
 * was being edited by three of them at once: this module is the only place these five are chosen, so
 * a later reconciliation touches one import and one spread there, not a whole block.
 *
 * The adapters are imported lazily, the same rule the window arm follows: a Linux launch never loads
 * the Win32 shim's source, and a Windows launch never loads the GTK one. Each adapter asks its
 * platform for the native half per call, so building the registry before `start()` is safe.
 *
 * `tray` also hands its instance to `platform/<os>/tray-tick.ts`, because a tray click is recorded by
 * the native side and reaches JavaScript only through a per-tick `pollClick()`. Registering the
 * adapter without that slot would be a tray that answers `setMenu` and never reports a click.
 */
import {
	createClipboardPlugin,
	createNotificationPlugin,
	createOpenerPlugin,
	createOsPlugin,
	createTrayPlugin,
} from "@/plugins";
import type { PluginDefinition } from "@/plugins/define";
import { nonDarwinDialogPlugin } from "@/runtime-dialog";

/** The namespaces this module replaces, per OS. Empty means the bare plugins stay registered. */
const REPLACED: Readonly<Record<string, readonly string[]>> = {
	win32: ["clipboard", "opener", "os", "dialog", "notification", "tray"],
	linux: ["clipboard", "opener", "os", "dialog", "notification", "tray"],
};

/** Whether `name` is registered from this module on `os`, so the bare one must be dropped. */
export function replacesCoreNamespace(name: string, os: string): boolean {
	return REPLACED[os]?.includes(name) ?? false;
}

/** The adapted instances for `os`; empty for a platform with no adapter, which keeps its refusals. */
export async function coreNamespacePlugins(os: string): Promise<PluginDefinition[]> {
	if (os === "win32") {
		const { windowsClipboardAdapter } = await import("@/platform/windows/clipboard");
		const { windowsOpenerAdapter } = await import("@/platform/windows/opener");
		const { windowsOsAdapter } = await import("@/platform/windows/os-info");
		const { windowsNotificationAdapter } =
			await import("@/platform/windows/notification-adapter");
		const { windowsTrayAdapter } = await import("@/platform/windows/tray-adapter");
		const { setActiveWindowsTray } = await import("@/platform/windows/tray-tick");
		// One instance, two owners: the plugin relays what it recorded, and the pump drains it.
		const tray = windowsTrayAdapter();
		setActiveWindowsTray(tray);
		return [
			createClipboardPlugin(windowsClipboardAdapter()),
			createOpenerPlugin(windowsOpenerAdapter()),
			createOsPlugin(windowsOsAdapter()),
			createNotificationPlugin(windowsNotificationAdapter()),
			createTrayPlugin(tray),
			await nonDarwinDialogPlugin(os),
		];
	}
	if (os === "linux") {
		const { linuxClipboardAdapter } = await import("@/platform/linux/clipboard");
		const { linuxOpenerAdapter } = await import("@/platform/linux/opener");
		const { linuxOsAdapter } = await import("@/platform/linux/os-info");
		const { linuxNotificationAdapter } = await import("@/platform/linux/notification-adapter");
		const { linuxTrayAdapter } = await import("@/platform/linux/tray-adapter");
		const { setActiveLinuxTray } = await import("@/platform/linux/tray-tick");
		// One instance, two owners: the plugin relays what GTK recorded, and the pump drains it.
		const tray = linuxTrayAdapter();
		setActiveLinuxTray(tray);
		return [
			createClipboardPlugin(linuxClipboardAdapter()),
			createOpenerPlugin(linuxOpenerAdapter()),
			createOsPlugin(linuxOsAdapter()),
			createNotificationPlugin(linuxNotificationAdapter()),
			createTrayPlugin(tray),
			await nonDarwinDialogPlugin(os),
		];
	}
	return [];
}
