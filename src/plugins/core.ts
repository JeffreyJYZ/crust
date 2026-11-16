/**
 * The plugin set that needs no platform instance, kept apart from the barrel so the
 * export list can grow without pushing `index.ts` past the line cap.
 *
 * `window` sits outside this list because its adapter needs the running `DarwinPlatform`
 * to read labels from, which only `startApp` has; the runtime appends it before
 * selection, so its name still matches `config.plugins`.
 *
 * `autostart` and `logging` are pure TypeScript and safe to carry everywhere;
 * `clipboard`, `opener`, `os`, `shortcuts`, `shell` and `updater` need an adapter
 * (a pasteboard, an allowlist, a manifest endpoint), so they are exported for an app
 * to register with its own options.
 */

import { autostartPlugin } from "./autostart";
import { dialogPlugin } from "./dialog";
import type { PluginDefinition } from "./define";
import { fsPlugin } from "./fs";
import { loggingPlugin } from "./logging";
import { notificationPlugin } from "./notification";
import { PluginRegistry } from "./registry";
import { strongholdPlugin } from "./stronghold";
import { trayPlugin } from "./tray";

export const corePlugins = [
	fsPlugin,
	dialogPlugin,
	notificationPlugin,
	trayPlugin,
	autostartPlugin,
	loggingPlugin,
	strongholdPlugin,
] as const satisfies readonly PluginDefinition[];

/** Every core plugin in one registry, ready for `startBridge({ handlers })`. */
export function coreRegistry(): PluginRegistry {
	return new PluginRegistry().register(...corePlugins);
}
