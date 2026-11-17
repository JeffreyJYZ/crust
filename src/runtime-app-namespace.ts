/**
 * The `app` namespace plugin, split out of `runtime-plugins.ts` when that file crossed the 200-line
 * cap. It is the only plugin whose handler closes over the `app` singleton, which is why it can live
 * on its own without dragging the native wiring with it.
 *
 * `info` is the page's route to `app.info()`: a command, not an `app:info` event, because the
 * answer has no moment to happen — it is the same on every call, and a page that wants it asks.
 * The same handlers also arm `app:` event delivery (`subscribePageEvents`), which is the only
 * place a page-side `ctx.emit` exists outside the bridge itself; arming is idempotent, so a page
 * that calls any `app.*` command at startup hears `app:activate` from then on.
 */
import { APP_NAMESPACE, type AppInfo, app } from "@/app.ts";
import { subscribePageEvents } from "@/app-watch.ts";
import { definePlugin, type PluginDefinition } from "@/plugins";

export function createAppNamespacePlugin(): PluginDefinition {
	return definePlugin({
		name: APP_NAMESPACE,
		commands: {
			invoke: async (payload: unknown, ctx) => {
				subscribePageEvents(ctx.emit);
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
			/** The app's own identity, the page-side half of Butter's `getinfo`. */
			info: (_payload: unknown, ctx): AppInfo => {
				subscribePageEvents(ctx.emit);
				return app.info();
			},
		},
	});
}
