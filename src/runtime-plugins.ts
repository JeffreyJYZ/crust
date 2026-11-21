/**
 * The plugins `startApp` registers: the platform's adapted core four, the window plugin the platform owns, and the runtime's own `app` namespace. Split out of `runtime.ts` because each needs a different instance — AppKit adapters, the running platform, or the `app` singleton.
 */

import type { ShellConfig } from "@/config";
import { crashRecordPath } from "@/platform/darwin/crash-record";
// Static, not part of the darwin-only dynamic import below: `scoped` runs on the non-darwin arm
// before that import is reached, and a `const` binding there would be in its temporal dead zone.
import { createFsPlugin, createWindowPlugin, type PluginDefinition } from "@/plugins";
import { createSidecarPlugin } from "@/plugins/sidecar";
import { defaultStateRoot } from "@/plugins/window-persist-store";
import { dataPlugins } from "@/runtime-data-plugins.ts";
import { startCrashPart } from "@/runtime-crash-start";
import { featurePlugins } from "@/runtime-feature-plugins.ts";
import { platformKeychainPlugin } from "@/runtime-keychain";
import {
	type NativePluginOptions,
	optionsOf,
	otherPlatformPlugins,
} from "@/runtime-plugins-other.ts";
import { darwinWebviews, installTestingAdapter } from "@/runtime-testing.ts";

export type { NativePluginOptions } from "@/runtime-plugins-other.ts";
/**
 * The `app` namespace moved to `runtime-app-namespace.ts` when this file crossed the 200-line cap.
 * Re-exported so every caller keeps importing it from here.
 */
export { createAppNamespacePlugin } from "./runtime-app-namespace.ts";

/**
 * Swap in the platform's native plugins. `dialog` and `window` are the two with a native half; each default export answers `not-implemented` and the real answer arrives through that plugin's `create*Plugin` hook, with `window` appended here because it also needs the running platform.
 * `shell` has no native half but needs the config's allowlist, so it is built here too: with no `shell` section the allowlist is empty and every `spawn` is refused by name.
 * `updater` is registered only when the config has an `updater` section: an app with no update story then carries no download-and-replace surface, and naming it in `plugins` is the unknown-plugin error it should be.
 * The updater self-gates `install` and `relaunch` on `process.platform`: off macOS they refuse with `unsupported-platform` rather than advertising an update path that cannot finish (`open -n` and the `.app` swap are macOS-shaped).
 * No platform, or not macOS, keeps the honest answers and still registers the plugin under its own name so `selectedPlugins` matches `config.plugins`.
 */
export async function nativePlugins(
	core: readonly PluginDefinition[],
	platform: import("@/platform/darwin").DarwinPlatform | undefined,
	options: NativePluginOptions | ShellConfig = {},
	os: string = process.platform,
): Promise<PluginDefinition[]> {
	const { shell, updater, fs, app: appId, pty, preview, browser } = optionsOf(options);
	const features = await featurePlugins({ pty, preview, browser });
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
		createTrayPlugin,
		createUpdaterPlugin,
		powerPlugin,
	} = await import("@/plugins");
	const shellPlugin = createShellPlugin({
		allow: shell?.allow,
		cwdRoot: shell?.cwdRoot,
	});
	// The sidecar plugin reads its declared names from the manifest `crust build` copied
	// beside the binary. It is always registered: with no manifest it declares no names and
	// refuses every spawn, which is the same deny-by-default shape as shell with no allowlist.
	const sidecarPlugin = createSidecarPlugin();
	const updaterPlugins = updater === undefined ? [] : [createUpdaterPlugin(undefined, updater)];
	// `store`, `database` and `stronghold` all own a file; dataPlugins gives them one per-app root
	// rather than the machine-wide `crust/` path the bare registrations used.
	const data = await dataPlugins(appRoot);
	const keychainPlugin = await platformKeychainPlugin();
	// `os` is a parameter so the win32 arm is provable on a machine that is not Windows: the
	// registry picks the adapter by OS, and no adapter branches on `process.platform` itself.
	if (!platform || os !== "darwin") {
		const other = await otherPlatformPlugins({
			core,
			scoped,
			app: appId,
			root: appRoot,
			power: powerPlugin,
			shell: shellPlugin,
			sidecar: sidecarPlugin,
			store: data.store,
			database: data.database,
			stronghold: data.stronghold,
			keychain: keychainPlugin,
			updater: updaterPlugins,
			os,
		});
		return [...other, ...features];
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
	const crash = await import("@/platform/darwin/crash");
	const locale = await import("@/platform/darwin/locale");
	const { startCrashGuard } = await import("@/runtime-crash-guard");
	const { darwinNetworkPlugin } = await import("@/runtime-network");
	const { createNavigationPlugin } = await import("@/plugins/navigation");
	const { createFindInPagePlugin } = await import("@/plugins/findinpage");
	const {
		createClipboardPlugin,
		createOpenerPlugin,
		createOsPlugin,
		createShortcutsPlugin,
		createWindowStatePlugin,
		createPositionerPlugin,
		createScreenPlugin,
		createMenuPlugin,
		createThemePlugin,
		createDockPlugin,
		createPowerPlugin,
		createAccessibilityPlugin,
		createDownloadsPlugin,
		createCrashReporterPlugin,
		createI18nPlugin,
		deepLink,
	} = await import("@/plugins");
	const deepLinkPlugin = deepLink.plugin;
	const windowAdapter = darwin.darwinWindowAdapter(platform);
	const webviewFor = darwinWebviews(platform);
	await installTestingAdapter(webviewFor);
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
		// A dev restart reads the frame back; the work areas keep a frame from a gone monitor off screen.
		createWindowStatePlugin({
			native: windowAdapter,
			app: appId,
			root: appRoot,
			workAreas: screen.windowWorkAreas,
		}),
		createPositionerPlugin({ native: windowAdapter, screen: screen.mainScreenFrame }),
		createScreenPlugin({ adapter: { list: screen.listScreens }, requires: "NSScreen screens" }),
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
		darwinNetworkPlugin({ configuration: darwin.webviewConfiguration }),
		createCrashReporterPlugin({ root: appRoot, guard, native: crashNative }),
		createI18nPlugin({ adapter: locale.darwinLocaleAdapter() }),
		keychainPlugin,
		deepLinkPlugin,
		data.store,
		data.database,
		data.stronghold,
		shellPlugin,
		sidecarPlugin,
		...updaterPlugins,
		...features,
	];
}
