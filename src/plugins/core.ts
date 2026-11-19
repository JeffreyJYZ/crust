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
 *
 * `testing` is the one namespace behind a gate. It is registered only when
 * `process.env.CRUST_TEST === "1"`, so a normal `crust build` carries no `testing`
 * handler at all and a page calling `invoke("testing", …)` gets `unknown-plugin` like
 * any other unregistered namespace — the capability that drives a page cannot ship to
 * a user by accident. An environment variable rather than a config key is deliberate:
 * a `testing` key in an app's own `crust.config.ts` is a setting somebody could leave
 * on, while `CRUST_TEST=1` is a property of the process that is started.
 */

import { autostartPlugin } from "./autostart";
import { dialogPlugin } from "./dialog";
import type { PluginDefinition } from "./define";
import { fsPlugin } from "./fs";
import { loggingPlugin } from "./logging";
import { notificationPlugin } from "./notification";
import { PluginRegistry } from "./registry";
import { strongholdPlugin } from "./stronghold";
import { testingPlugin } from "./testing";
import { trayPlugin } from "./tray";

/** What an environment says about this process, so the gate is provable without touching `process`. */
export type PluginEnv = Record<string, string | undefined>;

/** The namespaces every process carries, whatever environment it runs in. */
const ALWAYS = [
	fsPlugin,
	dialogPlugin,
	notificationPlugin,
	trayPlugin,
	autostartPlugin,
	loggingPlugin,
	strongholdPlugin,
] as const satisfies readonly PluginDefinition[];

/** True when this process was started as a test run: the one gate the `testing` namespace has. */
export function testingEnabled(env: PluginEnv = process.env): boolean {
	return env.CRUST_TEST === "1";
}

/**
 * Every core plugin for one environment. The gate is read here rather than inside the plugin, so a
 * build that never sets the variable has no `testing` name in its registry to refuse with anything
 * but `unknown-plugin` — the same answer a typo in a namespace gets.
 */
export function corePluginsFor(env: PluginEnv = process.env): readonly PluginDefinition[] {
	return testingEnabled(env) ? [...ALWAYS, testingPlugin] : ALWAYS;
}

export const corePlugins = corePluginsFor(process.env);

/** Every core plugin in one registry, ready for `startBridge({ handlers })`. */
export function coreRegistry(): PluginRegistry {
	return new PluginRegistry().register(...corePlugins);
}
