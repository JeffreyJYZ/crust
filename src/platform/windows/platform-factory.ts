/** Build the Windows platform. `appName` names the window class and every failure. */
import { type WindowsBackend, defaultBackend } from "./backend.ts";
import { type WindowsPlatformConfig } from "./platform-config.ts";
import { WindowsPlatform } from "./platform.ts";

export function createPlatform(
	config: WindowsPlatformConfig = {},
	backend: WindowsBackend = defaultBackend(),
): WindowsPlatform {
	return new WindowsPlatform(config, backend);
}
