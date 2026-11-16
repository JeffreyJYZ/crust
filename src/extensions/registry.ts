/**
 * The registry a generated entry fills with the extensions embedded in a compiled app. `crust build`
 * writes `registry.register(extension0.default, …)` before `startApp`, which registers this into the
 * core set when it builds the bridge, so a built app's extensions need no directory on the user's disk.
 */

import { PluginRegistry } from "../plugins/registry.ts";

export function extensionRegistry(): PluginRegistry {
	return new PluginRegistry();
}
