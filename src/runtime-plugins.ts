/**
 * The plugins `startApp` registers: the platform's adapted core four, the window plugin the platform owns, and the runtime's own `app` namespace. Split out of `runtime.ts` because each needs a different instance — AppKit adapters, the running platform, or the `app` singleton.
 */

import { APP_NAMESPACE, app } from "@/app.ts";
import type { FsConfig, ShellConfig, UpdaterConfig } from "@/config";
import { crashRecordPath } from "@/platform/darwin/crash-record";
import { createWindowPlugin, definePlugin, type PluginDefinition } from "@/plugins";
import { defaultStateRoot } from "@/plugins/window-persist-store";
import { startCrashPart } from "@/runtime-crash-start";

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
	/** Filesystem scope: when set, every `fs` command must resolve inside it. */
	fs?: FsConfig;
	/** The app's id, which names its data directory: crash records, store and downloads live there. */
	app?: string;
}

/** A bare `ShellConfig` is the third argument this function took before `updater` existed. */
function optionsOf(options: NativePluginOptions | ShellConfig): NativePluginOptions {
	const named = "shell" in options || "updater" in options || "app" in options;
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
	const { shell, updater, fs, app: appId } = optionsOf(options);
	// One data directory per app id; a static import, because the store is built before any platform.
	const appRoot = defaultStateRoot(appId ?? "crust");
	// `fs` carries the config's scope when one exists; with no scope the plugin
	// behaves exactly as before, which is what keeps existing apps working.
	const scoped = (plugin: PluginDefinition): PluginDefinition =>
		plugin.name === "fs" && fs?.scope !== undefined
			? (createFsPlugin({ allow: fs.scope }) as PluginDefinition)
			: plugin;
	const {
		createDialogPlugin,
		createNotificationPlugin,
		createShellPlugin,
		createStorePlugin,
		createTrayPlugin,
		createUpdaterPlugin,
	} = await import("@/plugins");
	const shellPlugin = createShellPlugin({ allow: shell?.allow, cwdRoot: shell?.cwdRoot });
	const updaterPlugins = updater === undefined ? [] : [createUpdaterPlugin(undefined, updater)];
	// `store` has no native half, but its file is per-app: with no adapter it answered
	// `~/Library/Application Support/crust/store.json` for every crust app.
	const storePlugin = createStorePlugin({ root: appRoot });
	if (!platform || process.platform !== "darwin") {
		return [
			...core.filter((plugin) => plugin.name !== "window").map(scoped),
			createWindowPlugin(),
			storePlugin,
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
	const theme = await import("@/platform/darwin/theme");
	const dock = await import("@/platform/darwin/dock");
	const power = await import("@/platform/darwin/power");
	const accessibility = await import("@/platform/darwin/accessibility");
	const navigation = await import("@/platform/darwin/navigation");
	const find = await import("@/platform/darwin/find");
	const downloads = await import("@/platform/darwin/downloads");
	const network = await import("@/platform/darwin/network");
	const crash = await import("@/platform/darwin/crash");
	const locale = await import("@/platform/darwin/locale");
	const { startCrashGuard } = await import("@/runtime-crash-guard");
	const { createNavigationPlugin } = await import("@/plugins/navigation");
	const { createFindInPagePlugin } = await import("@/plugins/findinpage");
	const {
		createFsPlugin,
		createClipboardPlugin,
		createOpenerPlugin,
		createOsPlugin,
		createShortcutsPlugin,
		createWindowStatePlugin,
		createPositionerPlugin,
		createMenuPlugin,
		createThemePlugin,
		createDockPlugin,
		createPowerPlugin,
		createAccessibilityPlugin,
		createDownloadsPlugin,
		createNetworkPlugin,
		createCrashReporterPlugin,
		createI18nPlugin,
		deepLink,
	} = await import("@/plugins");
	const deepLinkPlugin = deepLink.plugin;
	const { webviewResolver } = await import("@/platform/darwin/webview-target");
	const windowAdapter = darwin.darwinWindowAdapter(platform);
	/**
	 * The `WKWebView` of one window, chosen by label and resolved per call so a window created
	 * after registration is still reachable. With no label it is the app's first open window,
	 * which is what a single-window caller means; a label that names no open window answers
	 * `bad-request` rather than silently acting on that first window.
	 */
	const webviewFor = webviewResolver(platform);
	const crashNative = {
		arm: (recordPath: string) => crash.armCrashHandlers(recordPath),
		disarm: () => crash.disarmCrashHandlers(),
	};
	const crashPart = startCrashPart({
		root: appRoot,
		record: crashRecordPath(appRoot),
		start: (input) => startCrashGuard(input),
		native: crashNative,
	});
	const guard = crashPart.guard;
	return [
		...core.map(scoped).map((plugin) => {
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
		createThemePlugin(theme.darwinThemeAdapter()),
		createDockPlugin(dock.darwinDockAdapter()),
		createPowerPlugin(power.darwinPowerAdapter()),
		createAccessibilityPlugin(accessibility.darwinAccessibilityAdapter()),
		createNavigationPlugin(navigation.darwinNavigationAdapter(webviewFor)),
		createFindInPagePlugin(find.darwinFindAdapter(webviewFor)),
		createDownloadsPlugin(downloads.darwinDownloadsAdapter({ webview: webviewFor }), {
			app: appId,
		}),
		createNetworkPlugin(network.darwinNetworkAdapter()),
		createCrashReporterPlugin({ root: appRoot, guard, native: crashNative }),
		createI18nPlugin({ adapter: locale.darwinLocaleAdapter() }),
		deepLinkPlugin,
		storePlugin,
		shellPlugin,
		...updaterPlugins,
	];
}
