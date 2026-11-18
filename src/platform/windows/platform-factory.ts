/** Build the Windows platform. `appName` names the window class and every failure. */
import { type WindowsBackend, defaultBackend } from "./backend.ts";
import { type WindowsPlatformConfig } from "./platform-config.ts";
import { WindowsPlatform } from "./platform.ts";
import { setActiveWindowsPlatform } from "./active-platform.ts";

export function createPlatform(
	config: WindowsPlatformConfig = {},
	backend: WindowsBackend = defaultBackend(),
): WindowsPlatform {
	const platform = new WindowsPlatform(config, backend);
	// Recorded before `start()`, because the registry builds the window adapter before
	// `app.run()` calls it; the adapter resolves the platform per call, so an early
	// registration costs nothing and a missing one is a named refusal.
	setActiveWindowsPlatform(platform);
	return platform;
}
