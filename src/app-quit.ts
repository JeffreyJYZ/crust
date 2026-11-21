/**
 * The one quit sequence, shared by `app.quit()` and the every-window-closed watch. Both paths emit
 * `before-quit` then `will-quit`, then let the frame, the log and the platform finish in that order;
 * only the first caller owns it. A `window-all-closed` listener that calls `app.quit()` is the
 * shipped template shape, so the second path must never start a second quit — that used to fire
 * `platform.quit()` while an async `before-quit` save was still running.
 */

import { flushLogger } from "@/logging/logger";
import { logAppQuit } from "./app-log.ts";
import { emitOnQuit } from "./app-watch.ts";
import type { AppEvent, AppListener, Platform } from "./app-types.ts";
import { reapChildren } from "./child-reap.ts";
import { frameMemory } from "./plugins/window-frame-memory.ts";

/** Emit the save-on-quit events, then let the frame, the log and the platform finish. */
export function finishQuit(
	listeners: Map<AppEvent, Set<AppListener>>,
	platform?: Platform,
): Promise<void> {
	return emitOnQuit(listeners, "before-quit")
		.then(() => emitOnQuit(listeners, "will-quit"))
		.then(() => frameMemory()?.flush())
		.then(() => flushLogger())
		.then(() => platform?.quit());
}

export interface Quitter {
	/** Hand the quitter the watch handles so a quit can stop them. */
	timers(
		windowCheck: ReturnType<typeof setInterval> | undefined,
		lifecycleCheck: ReturnType<typeof setInterval> | undefined,
	): void;
	/**
	 * Begin a quit. The first caller stops the watches, reaps children and runs `onFirst`; every
	 * later caller is a no-op, so an event path and a handler cannot quit twice.
	 */
	begin(reason: string, onFirst?: () => void): boolean;
}

export function createQuitter(): Quitter {
	let quitting = false;
	let windowCheck: ReturnType<typeof setInterval> | undefined;
	let lifecycleCheck: ReturnType<typeof setInterval> | undefined;
	return {
		timers(window, lifecycle) {
			windowCheck = window;
			lifecycleCheck = lifecycle;
		},
		begin(reason, onFirst) {
			if (quitting) return false;
			quitting = true;
			logAppQuit(reason);
			clearInterval(windowCheck);
			clearInterval(lifecycleCheck);
			windowCheck = undefined;
			lifecycleCheck = undefined;
			// A child that handles TERM exits during the logger flush; the exit listener escalates.
			reapChildren("SIGTERM");
			onFirst?.();
			return true;
		},
	};
}
