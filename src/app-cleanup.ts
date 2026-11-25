/**
 * The shared undo for a run that started a platform but failed before handing the process to the
 * pump. Closing the configured windows is enough: a full `platform.quit()` would call
 * `process.exit(0)` on macOS and hide the error that got us here.
 */

import type { CrustConfig } from "@/config";
import type { Platform } from "./app-types.ts";

export function closeConfiguredWindows(platform: Platform, config: CrustConfig): void {
	for (const window of config.windows) {
		try {
			platform.destroy(window.label);
		} catch {
			// A window that never opened needs no close.
		}
	}
}
