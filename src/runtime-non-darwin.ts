/**
 * The plugin set a platform without a native layer still registers. Split from `runtime-plugins.ts`
 * when that file reached the line cap: on Linux and Windows the bare plugins each answer
 * `not-implemented` by name, so a page can branch on the concept instead of crashing at startup with
 * `unknown-plugin` (`src/runtime-shim.ts` throws when `config.plugins` names an unregistered plugin).
 *
 * Screen is the one namespace with a working half on both platforms: the GDK and EnumDisplayMonitors
 * adapters are compiled but were never selected. The adapters are injectable here so the selection
 * is testable on a machine that has neither GTK nor Win32 — the test proves which adapter is chosen,
 * not that the OS answers.
 */

import { linuxScreenAdapter } from "@/platform/linux/screen";
import { windowsScreenAdapter } from "@/platform/windows/screen";
import type { PluginDefinition } from "@/plugins/define";
import {
	accessibilityPlugin,
	clipboardPlugin,
	crashReporterPlugin,
	deepLink,
	dockPlugin,
	downloadsPlugin,
	findinpagePlugin,
	i18nPlugin,
	menuPlugin,
	navigationPlugin,
	networkPlugin,
	openerPlugin,
	osPlugin,
	positionerPlugin,
	screenPlugin,
	shortcutsPlugin,
	themePlugin,
	windowStatePlugin,
	createScreenPlugin,
	type ScreenAdapter,
} from "@/plugins";

/**
 * The seventeen namespaces the darwin branch registers with real adapters and the non-darwin branch
 * never registered at all. Each bare export refuses with `not-implemented` naming what it needs.
 * Order is the report's order and matters only for readability; the registry keys by name.
 */
export const nonDarwinPlugins: readonly PluginDefinition[] = [
	clipboardPlugin,
	openerPlugin,
	osPlugin,
	shortcutsPlugin,
	windowStatePlugin,
	positionerPlugin,
	menuPlugin,
	themePlugin,
	dockPlugin,
	accessibilityPlugin,
	navigationPlugin,
	findinpagePlugin,
	downloadsPlugin,
	networkPlugin,
	crashReporterPlugin,
	i18nPlugin,
	deepLink.plugin,
];

/** The screen plugin for a non-darwin OS. Each platform names the call it would need. */
export function nonDarwinScreenPlugin(
	os: string = process.platform,
	adapters: { linux?: ScreenAdapter; windows?: ScreenAdapter } = {},
): PluginDefinition<"screen"> {
	if (os === "linux") {
		return createScreenPlugin({
			adapter: adapters.linux ?? linuxScreenAdapter(),
			requires: "gdk_display_get_monitor",
		});
	}
	if (os === "win32") {
		return createScreenPlugin({
			adapter: adapters.windows ?? windowsScreenAdapter(),
			requires: "EnumDisplayMonitors",
		});
	}
	return screenPlugin;
}
