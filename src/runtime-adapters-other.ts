/**
 * The three namespaces a normal app hits in its first hour — `clipboard`, `opener` and `os.info` —
 * registered with the platform's own adapter instead of the bare refusal.
 *
 * Kept apart from `runtime-plugins-other.ts` because that file carries every lane's registration and
 * was being edited by three of them at once: this module is the only place these three are chosen, so
 * a later reconciliation touches one import and one spread there, not a whole block.
 *
 * The adapters are imported lazily, the same rule the window arm follows: a Linux launch never loads
 * the Win32 shim's source, and a Windows launch never loads the GTK one. Each adapter asks its
 * platform for the native half per call, so building the registry before `start()` is safe.
 */
import { createClipboardPlugin, createOpenerPlugin, createOsPlugin } from "@/plugins";
import type { PluginDefinition } from "@/plugins/define";

/** The namespaces this module replaces, per OS. Empty means the bare plugins stay registered. */
const REPLACED: Readonly<Record<string, readonly string[]>> = {
	win32: ["clipboard", "opener", "os"],
	linux: ["clipboard", "opener", "os"],
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
		return [
			createClipboardPlugin(windowsClipboardAdapter()),
			createOpenerPlugin(windowsOpenerAdapter()),
			createOsPlugin(windowsOsAdapter()),
		];
	}
	if (os === "linux") {
		const { linuxClipboardAdapter } = await import("@/platform/linux/clipboard");
		const { linuxOpenerAdapter } = await import("@/platform/linux/opener");
		const { linuxOsAdapter } = await import("@/platform/linux/os-info");
		return [
			createClipboardPlugin(linuxClipboardAdapter()),
			createOpenerPlugin(linuxOpenerAdapter()),
			createOsPlugin(linuxOsAdapter()),
		];
	}
	return [];
}
