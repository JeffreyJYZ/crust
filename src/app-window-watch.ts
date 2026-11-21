/**
 * The "every window is gone" watch and what a quit means for it, split out of `app.ts` when the
 * lifecycle logging pushed the class past the line cap.
 *
 * The platform's lifecycle source only sees a user's ⌘Q, so the save-on-quit events are emitted
 * here too: the most common quit is every window closing, and a listener that throws must not keep
 * a windowless process alive. `emitOnQuit` names the error and still lets the next event and the
 * quit run.
 */

import type { CrustConfig } from "@/config";
import { emitOnQuit, watchWindows } from "./app-watch.ts";
import { finishQuit } from "./app-quit.ts";
import type { AppEvent, AppListener, Platform } from "./app-types.ts";

export function watchAllClosed(
	listeners: Map<AppEvent, Set<AppListener>>,
	config: CrustConfig,
	platform: Platform,
	begin: () => boolean,
): ReturnType<typeof setInterval> | undefined {
	if (!listeners.get("window-all-closed")?.size) return undefined;
	return watchWindows(config, platform, () => {
		if (!begin()) return;
		void emitOnQuit(listeners, "window-all-closed").then(() => finishQuit(listeners, platform));
	});
}
