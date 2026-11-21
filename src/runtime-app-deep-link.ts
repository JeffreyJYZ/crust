/**
 * The `app` namespace plugin, wrapped so a page arming its `ctx.emit` also arms deep-link
 * delivery. The base plugin is where a page-side emit first exists at runtime; wrapping it here
 * keeps `runtime-app-namespace.ts` and its callers untouched.
 */

import { armDeepLinkPage } from "./app-deep-link.ts";
import { definePlugin, type PluginContext, type PluginDefinition } from "@/plugins";
import { createAppNamespacePlugin as createBaseAppNamespacePlugin } from "./runtime-app-namespace.ts";

export function createAppNamespacePlugin(): PluginDefinition {
	const base = createBaseAppNamespacePlugin();
	const commands: Record<string, (args: any, ctx: PluginContext) => any> = {};
	for (const [name, handler] of Object.entries(base.commands)) {
		commands[name] = (args: any, ctx: PluginContext) => {
			armDeepLinkPage(ctx.emit);
			return handler(args, ctx);
		};
	}
	return definePlugin({ name: base.name, commands });
}
