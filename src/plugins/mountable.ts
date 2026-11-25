/**
 * The names a project may not claim with `app.use`, and the check that enforces them. Split out of
 * `app-loop.ts` so the reserved set lives beside the registry rules it protects; `app-loop` still
 * re-exports both, so callers keep their imports.
 */

import { CrustError } from "../bridge/errors";
import { APP_NAMESPACE } from "../app-types.ts";
import { definePlugin, type PluginDefinition } from "./define.ts";
import { corePlugins, windowPlugin } from "./index.ts";

/**
 * Every name `startApp` may register before a project's own plugins, not just the core four. The
 * list is a superset on purpose: `pty` and `updater` are conditional, and a name reserved on a
 * build that omits them still must not be claimed by a project plugin on one that includes them.
 * These are all namespaces in the one bridge handler table; `PluginRegistry.register()` throws on
 * a duplicate, so a collision left to startup used to surface from `app.run()` rather than from
 * the `app.use()` call that promised to refuse it.
 */
export const RESERVED_PLUGIN_NAMES: ReadonlySet<string> = new Set([
	APP_NAMESPACE,
	windowPlugin.name,
	...corePlugins.map((plugin) => plugin.name),
	// Built by the runtime with this app's data root or a native adapter rather than kept in
	// `corePlugins`, but every one is still a built-in namespace.
	"stronghold",
	"clipboard",
	"opener",
	"os",
	"shortcut",
	"window-state",
	"positioner",
	"screen",
	"menu",
	"theme",
	"dock",
	"power",
	"accessibility",
	"navigation",
	"findinpage",
	"downloads",
	"network",
	"crash-reporter",
	"i18n",
	"keychain",
	"deep-link",
	"store",
	"database",
	"shell",
	"sidecar",
	"updater",
	"preview",
	"browser",
	"pty",
	"single-instance",
]);

/**
 * Check that a project plugin may be mounted, and freeze it the way `definePlugin` would. The name
 * is a namespace and must be unused (a duplicate, a built-in or the reserved `app` is refused,
 * never shadowed), and the mount must happen before `run()`, which the caller checks because it
 * owns the started flag.
 */
export function mountable(
	plugin: PluginDefinition,
	mounted: ReadonlyMap<string, PluginDefinition>,
): PluginDefinition {
	if (typeof plugin !== "object" || plugin === null)
		throw new CrustError(
			"bad-request",
			"app.use: not a plugin definition (expected { name, commands })",
		);

	const definition = definePlugin(plugin);
	const name = definition.name;
	if (name === APP_NAMESPACE) {
		throw new CrustError("bad-request", `app.use: "${name}" is the reserved app namespace`);
	}
	if (RESERVED_PLUGIN_NAMES.has(name)) {
		throw new CrustError(
			"bad-request",
			`app.use: "${name}" is a built-in plugin — a name is a namespace, so pick another`,
		);
	}
	if (mounted.has(name)) {
		throw new CrustError("bad-request", `app.use: plugin "${name}" is already mounted`);
	}
	return definition;
}
