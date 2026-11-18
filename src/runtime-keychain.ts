/**
 * The `keychain` plugin for whichever platform is running, split out of `runtime-plugins.ts` when that
 * file passed the 200-line cap.
 *
 * macOS answers with `Security.framework`, Windows with `advapi32`, and Linux with libsecret's
 * synchronous API over the dlopen'd C shim — no GLib main loop is needed because libsecret spins its
 * own for `*_sync`. An unrecognised platform gets the plugin with no adapter, so each command refuses
 * by name instead of the name being unknown; a plaintext file called secure is the one lie worse.
 */

import type { PluginDefinition } from "@/plugins";

/** The platform's own credential store, or the honest refusal when it has none. */
export async function platformKeychainPlugin(): Promise<PluginDefinition> {
	const { createKeychainPlugin } = await import("@/plugins");
	if (process.platform === "win32") {
		const { windowsKeychainAdapter } = await import("@/platform/windows/keychain");
		return createKeychainPlugin(windowsKeychainAdapter());
	}
	if (process.platform === "darwin") {
		const { darwinKeychainAdapter } = await import("@/platform/darwin/keychain");
		return createKeychainPlugin(darwinKeychainAdapter());
	}
	if (process.platform === "linux") {
		const { linuxKeychainAdapter } = await import("@/platform/linux/keychain");
		return createKeychainPlugin(linuxKeychainAdapter());
	}
	return createKeychainPlugin();
}
