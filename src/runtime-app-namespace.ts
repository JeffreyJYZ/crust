/**
 * The `app` namespace plugin, split out of `runtime-plugins.ts` when that file crossed the 200-line
 * cap. It is the only plugin whose handler closes over the `app` singleton, which is why it can live
 * on its own without dragging the native wiring with it.
 */
import { APP_NAMESPACE, app } from "@/app.ts";
import { definePlugin, type PluginDefinition } from "@/plugins";

export function createAppNamespacePlugin(): PluginDefinition {
	return definePlugin({
		name: APP_NAMESPACE,
		commands: {
			invoke: async (payload: unknown) => {
				const { name, args } = (payload ?? {}) as { name?: unknown; args?: unknown };
				if (typeof name !== "string" || name.length === 0) {
					throw new Error("crust: app.invoke needs { name, args }");
				}
				const commandArgs =
					typeof args === "object" && args !== null && !Array.isArray(args)
						? (args as Record<string, unknown>)
						: {};
				return await app.invoke(name, commandArgs);
			},
		},
	});
}
