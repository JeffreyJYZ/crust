/**
 * The runtime's page-side shim and its plugin selection rules. `INVOKE_SHIM` is the one-name `invoke` the design page (`site/app/docs/design/page.mdx`) promises, injected after the bridge's bootstrap, and `selectedPlugins` decides which core plugins a config asks for.
 */

import { APP_NAMESPACE } from "@/app.ts";
import type { CrustConfig } from "@/config";
import type { PluginDefinition } from "@/plugins";

/**
 * The page-side shim, installed after the bridge's bootstrap. `installCrust` speaks `(plugin, command, args)`, which is what plugin calls use; the design page (`site/app/docs/design/page.mdx`) has the page call `invoke("greet", { name })`, so a two-argument call is routed to the `app` namespace and a string second argument is the explicit plugin form, passed through untouched.
 */
export const INVOKE_SHIM = `<script>(function () {
	var api = window.crust;
	if (!api || typeof api.invoke !== "function") return;
	var raw = api.invoke.bind(api);
	api.invoke = function (name, command, args) {
		if (typeof command === "string") return raw(name, command, args);
		return raw("${APP_NAMESPACE}", "invoke", { name: name, args: command === undefined ? {} : command });
	};
})();</script>`;

/** Put the shim where the parser reaches it before any page script. */
export function injectShim(html: string): string {
	const bodyOpen = /<body[^>]*>/i;
	if (bodyOpen.test(html)) return html.replace(bodyOpen, (tag) => `${tag}${INVOKE_SHIM}`);
	return `${INVOKE_SHIM}${html}`;
}

/** `crust:fs` -> `fs`; a bare `fs` is accepted too. */
function pluginName(entry: string): string {
	return entry.startsWith("crust:") ? entry.slice("crust:".length) : entry;
}

/** The core plugins the config asked for, or all four when it names none. */
export function selectedPlugins(
	config: CrustConfig,
	core: readonly PluginDefinition[],
): PluginDefinition[] {
	if (!config.plugins || config.plugins.length === 0) return [...core];
	const wanted = config.plugins.map(pluginName);
	const known = core.map((plugin) => plugin.name);
	for (const name of wanted) {
		if (!known.includes(name)) {
			throw new Error(`crust: unknown plugin "${name}" — v1 ships ${known.join(", ")}`);
		}
	}
	return core.filter((plugin) => wanted.includes(plugin.name));
}
