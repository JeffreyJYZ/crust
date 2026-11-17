/**
 * The `keychain` plugin for whichever platform is running, split out of `runtime-plugins.ts` when that
 * file passed the 200-line cap.
 *
 * macOS answers with `Security.framework` and Windows with `advapi32`; every other platform gets the
 * plugin with no adapter, so each command refuses by name instead of the name being unknown. Linux is
 * deliberately `not-implemented`: libsecret needs a running keyring daemon and a GLib main loop crust
 * does not bind, and a plaintext file called secure is the one lie worse than a refusal.
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
	return createKeychainPlugin();
}
