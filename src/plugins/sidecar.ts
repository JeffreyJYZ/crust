/**
 * `crust:sidecar` — spawn a binary that shipped inside the bundle beside the app's executable.
 * Names come from `build.sidecars`; a page cannot name a program that was not declared, and a
 * declared name whose file is missing is a typed failure rather than a bare `ENOENT` from spawn.
 * The four commands (spawn/write/list/kill) share one live-child registry in `sidecar-control.ts`.
 */

import { installReapOnExit } from "../child-reap.ts";
import { definePlugin, type PluginDefinition } from "./define";
import { makeSidecarCommands } from "./sidecar-control";
import { declaredSidecars, defaultSidecarDir } from "./sidecar-locate";
import type { SidecarCommands, SidecarOptions } from "./sidecar-types";

export * from "./sidecar-locate";
export * from "./sidecar-process";
export * from "./sidecar-types";

/**
 * Build the plugin. The declared set is frozen at construction so a page cannot widen it, and a
 * missing file is reported before any process exists.
 */
export function createSidecarPlugin(
	options: SidecarOptions = {},
): PluginDefinition<"sidecar", SidecarCommands> {
	const dir = options.dir ?? defaultSidecarDir();
	// Explicit names win (tests and hosts that read config themselves); otherwise the build
	// manifest beside the binary is the declaration, so a spawned name must have been shipped.
	const names = new Set(options.names ?? declaredSidecars(dir));
	// A spawned daemon is otherwise ended only by `sidecar.kill`, so quitting or a dev restart
	// left it running beside the next start. The reap covers both.
	installReapOnExit();
	return definePlugin({
		name: "sidecar",
		commands: makeSidecarCommands({ dir, names, options }),
	});
}

/** The plugin a page reaches as `window.crust.invoke("sidecar", "spawn", …)`. */
export const sidecarPlugin = createSidecarPlugin();
