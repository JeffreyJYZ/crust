/**
 * The three feature plugins this release declares: `pty`, `preview` and `browser`, each a real
 * plugin now, and the sections that opt them in.
 *
 * One named factory, so the naming, the gating and the shape of each registration live in one file a
 * feature lane can replace without touching the runtime: `runtime-plugins.ts` only spreads what this
 * answers, and a name that resolves to nothing never reaches the bridge, because every definition
 * here exists or is not returned. `preview` carries the config's default size; its own commands are
 * the real panel, whose platform half answers `not-implemented` naming what it waits on where a
 * platform has no embedded preview — honest at the wire, and it keeps the documented capability
 * action a real command name.
 */
import type { BrowserConfig, PreviewConfig, PtyConfig } from "@/config";
import { createBrowserPlugin } from "@/plugins/browser";
import { createPreviewPlugin, createPtyPlugin, type PluginDefinition } from "@/plugins";

/** The config sections that opt a feature in. Each is optional; only `pty` gates registration. */
export interface FeatureSections {
	pty?: PtyConfig;
	preview?: PreviewConfig;
	browser?: BrowserConfig;
}

/**
 * The plugin set these sections ask for. An absent `pty` answers no pty definition at all: a
 * page-reachable terminal is command execution, so it exists only because the app declared the
 * section, never because a plugin list mentioned its name. `preview` and `browser` are registered
 * either way — a panel is layout and an embedded page is bounded by its origin list, so neither
 * executes anything on its own.
 */
export async function featurePlugins(sections: FeatureSections): Promise<PluginDefinition[]> {
	const plugins: PluginDefinition[] = [];
	if (sections.pty !== undefined) plugins.push(createPtyPlugin(sections.pty));
	// With no `preview` section the panel opens at its own default size; the scope it reads comes
	// from the runtime's `fs.scope` instance, resolved per call inside the plugin.
	plugins.push(
		createPreviewPlugin({
			width: sections.preview?.width,
			height: sections.preview?.height,
		}),
	);
	// With no `browser` section this still registers and allows no origin: the plugin reads
	// `origins` and refuses every load rather than loading by default. Each platform gets its own
	// native surface — WKWebView, WebView2, WebKitGTK — and a platform with none keeps the typed
	// `not-implemented` inside the same plugin.
	if (process.platform === "darwin") {
		const { darwinBrowserAdapter } = await import("@/platform/darwin/browser");
		plugins.push(createBrowserPlugin(sections.browser, darwinBrowserAdapter()));
	} else if (process.platform === "win32") {
		const { windowsBrowserAdapter } = await import("@/platform/windows/browser");
		plugins.push(createBrowserPlugin(sections.browser, windowsBrowserAdapter()));
	} else if (process.platform === "linux") {
		const { linuxBrowserAdapter } = await import("@/platform/linux/browser");
		plugins.push(createBrowserPlugin(sections.browser, linuxBrowserAdapter()));
	} else {
		plugins.push(createBrowserPlugin(sections.browser));
	}
	return plugins;
}
