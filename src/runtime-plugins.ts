/**
 * The plugins `startApp` registers: the platform's adapted core four, the window plugin the platform owns, and the runtime's own `app` namespace. Split out of `runtime.ts` because each needs a different instance — AppKit adapters, the running platform, or the `app` singleton.
 */

import { APP_NAMESPACE, app } from "@/app.ts";
import type { ShellConfig, UpdaterConfig } from "@/config";
import { createWindowPlugin, definePlugin, type PluginDefinition } from "@/plugins";

/**
 * The `app` namespace: what a two-argument `invoke(name, args)` reaches. It is the same object for every launch, so commands registered by main.ts after the bridge starts stay reachable — the handler closes over `app` rather than snapshotting its command table.
 */
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

/** The config sections that change which plugin an app gets. */
export interface NativePluginOptions {
	shell?: ShellConfig;
	updater?: UpdaterConfig;
}

/** A bare `ShellConfig` is the third argument this function took before `updater` existed. */
function optionsOf(options: NativePluginOptions | ShellConfig): NativePluginOptions {
	const named = "shell" in options || "updater" in options;
	return named ? (options as NativePluginOptions) : { shell: options as ShellConfig };
}

/**
 * Swap in the platform's native plugins. `dialog` and `window` are the two with a native half; each default export answers `not-implemented` and the real answer arrives through that plugin's `create*Plugin` hook, with `window` appended here because it also needs the running platform.
 * `shell` has no native half but needs the config's allowlist, so it is built here too: with no `shell` section the allowlist is empty and every `spawn` is refused by name.
 * `updater` is registered only when the config has an `updater` section: an app with no update story then carries no download-and-replace surface, and naming it in `plugins` is the unknown-plugin error it should be.
 * No platform, or not macOS, keeps the honest answers and still registers the plugin under its own name so `selectedPlugins` matches `config.plugins`.
 */
export async function nativePlugins(
	core: readonly PluginDefinition[],
	platform: import("@/platform/darwin").DarwinPlatform | undefined,
	options: NativePluginOptions | ShellConfig = {},
): Promise<PluginDefinition[]> {
	const { shell, updater } = optionsOf(options);
	const {
		createDialogPlugin,
		createNotificationPlugin,
		createShellPlugin,
		createTrayPlugin,
		createUpdaterPlugin,
	} = await import("@/plugins");
	const shellPlugin = createShellPlugin({ allow: shell?.allow, cwdRoot: shell?.cwdRoot });
	const updaterPlugins = updater === undefined ? [] : [createUpdaterPlugin(undefined, updater)];
	if (!platform || process.platform !== "darwin") {
		return [
			...core.filter((plugin) => plugin.name !== "window"),
			createWindowPlugin(),
			shellPlugin,
			...updaterPlugins,
		];
	}
	const darwin = await import("@/platform/darwin");
	const notifications = await import("@/platform/darwin/notifications");
	const statusBar = await import("@/platform/darwin/status-bar");
	const clipboard = await import("@/platform/darwin/clipboard");
	const opener = await import("@/platform/darwin/opener");
	const osInfo = await import("@/platform/darwin/os-info");
	const shortcuts = await import("@/platform/darwin/shortcuts");
	const screen = await import("@/platform/darwin/screen");
	const {
		createClipboardPlugin,
		createOpenerPlugin,
		createOsPlugin,
		createShortcutsPlugin,
		createWindowStatePlugin,
		createPositionerPlugin,
		createMenuPlugin,
		deepLink,
	} = await import("@/plugins");
	const deepLinkPlugin = deepLink.plugin;
	const windowAdapter = darwin.darwinWindowAdapter(platform);
	return [
		...core.map((plugin) => {
			switch (plugin.name) {
				case "dialog":
					return createDialogPlugin(darwin.darwinDialogAdapter());
				case "tray":
					return createTrayPlugin(statusBar.createStatusBar());
				case "notification":
					return createNotificationPlugin(notifications.darwinNotificationAdapter());
				default:
					return plugin;
			}
		}),
		createWindowPlugin(windowAdapter),
		createClipboardPlugin(clipboard.darwinClipboardAdapter()),
		createOpenerPlugin(opener.darwinOpenerAdapter()),
		createOsPlugin(osInfo.darwinOsAdapter()),
		createShortcutsPlugin(shortcuts.darwinShortcutsAdapter()),
		createWindowStatePlugin({ native: windowAdapter }),
		createPositionerPlugin({ native: windowAdapter, screen: screen.mainScreenFrame }),
		createMenuPlugin(darwin.darwinMenuAdapter()),
		deepLinkPlugin,
		shellPlugin,
		...updaterPlugins,
	];
}
