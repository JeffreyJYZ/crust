/**
 * The two places the app lifecycle touches the dev window frame, kept out of `app.ts` so that class
 * stays the lifecycle. Both are no-ops without a memory, which is a built app and every test.
 */

import type { AppListener } from "./app-types.ts";
import { frameMemory } from "./plugins/window-frame-memory.ts";

/**
 * The `before-quit` listener that writes the frame while the windows still exist. A user's ⌘Q
 * arrives here before the platform closes anything, so the frame read is the live one rather than
 * the last sample.
 */
export function frameQuitListener(): AppListener | undefined {
	const memory = frameMemory();
	return memory === undefined ? undefined : () => memory.saveAll();
}

/**
 * Finish a quit after one last write. `quit()` closes the windows the frame comes from, so the
 * platform's own quit has to wait for the save; a refused write must still let the app exit.
 */
export function quitAfterSaving(finish: () => void): void {
	const memory = frameMemory();
	if (memory === undefined) {
		finish();
		return;
	}
	void memory
		.saveAll()
		.catch(() => undefined)
		.finally(() => {
			memory.stop();
			finish();
		});
}
