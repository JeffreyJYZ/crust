/**
 * The `i18n` instance the runtime registers. Its `load` command reads a locale directory from a
 * page, so when the app declares `fs.scope` the plugin gets that same boundary. Split out of
 * `runtime-plugins.ts` at the 200-line cap.
 */

import type { FsConfig } from "@/config";
import { createFsPlugin, createI18nPlugin, i18nPlugin, type PluginDefinition } from "@/plugins";
import { createFsScope } from "@/plugins/fs-scope.ts";
import type { ScopeCheck } from "@/plugins/fs-scope-in-force.ts";
import type { I18nAdapter } from "@/plugins/i18n-types.ts";

/**
 * The filesystem-bound instances for one app: `fs` carries the configured scope, `i18n.load`
 * inherits it, and both no-op when the app declared no `fs.scope` — the compatibility default.
 */
export function scopedPlugins(fs: FsConfig | undefined): {
	scope: ScopeCheck | undefined;
	i18n: PluginDefinition;
	scoped: (plugin: PluginDefinition) => PluginDefinition;
} {
	const scope = fs?.scope !== undefined ? createFsScope({ allow: fs.scope }) : undefined;
	return {
		scope,
		i18n: runtimeI18n(scope),
		scoped: (plugin) =>
			plugin.name === "fs" && fs?.scope !== undefined
				? (createFsPlugin({ allow: fs.scope }) as PluginDefinition)
				: plugin,
	};
}

/** The bare plugin when no scope is configured; a scoped one otherwise. */
export function runtimeI18n(scope: ScopeCheck | undefined): PluginDefinition {
	return scope === undefined ? i18nPlugin : createI18nPlugin({ scope });
}

/** The darwin arm also has a native locale adapter to carry into the scoped plugin. */
export function darwinI18n(scope: ScopeCheck | undefined, adapter: I18nAdapter): PluginDefinition {
	return createI18nPlugin({ adapter, scope });
}
