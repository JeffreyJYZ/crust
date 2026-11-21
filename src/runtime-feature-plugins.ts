/**
 * The three feature plugins this release declares. Two are still pending a later release; `pty` is
 * real, and its section is the only thing that registers it.
 *
 * One named factory, so the naming, the gating and the refusal live in one file a feature lane can
 * replace without touching the runtime: `runtime-plugins.ts` only spreads what this answers, and a
 * name that resolves to nothing never reaches the bridge, because every definition here exists or is
 * not returned. A command that cannot work on this platform answers `not-implemented` naming what it
 * waits on — honest at the wire, and it keeps the documented capability action a real command name.
 */
import type { BrowserConfig, PreviewConfig, PtyConfig } from "@/config";
import { createPtyPlugin, definePlugin, notImplemented, type PluginDefinition } from "@/plugins";
import { createBrowserPlugin } from "@/plugins/browser";

/** The config sections that opt a feature in. Each is optional; only `pty` gates registration. */
export interface FeatureSections {
	pty?: PtyConfig;
	preview?: PreviewConfig;
	browser?: BrowserConfig;
}

/** The release the one still-unimplemented feature ships in. */
const RELEASE = { preview: "0.2.10" } as const;

function pending(name: keyof typeof RELEASE, command: string, feature: string): PluginDefinition {
	const release = RELEASE[name];
	return definePlugin({
		name,
		commands: {
			[command]: () =>
				notImplemented(`${name}.${command} ships in crust ${release}: ${feature}`, release),
		},
	});
}

/**
 * The plugin set these sections ask for. An absent `pty` answers no pty definition at all: a
 * page-reachable terminal is command execution, so it exists only because the app declared the
 * section, never because a plugin list mentioned its name.
 */
export async function featurePlugins(sections: FeatureSections): Promise<PluginDefinition[]> {
	const plugins: PluginDefinition[] = [];
	if (sections.pty !== undefined) plugins.push(createPtyPlugin(sections.pty));
	plugins.push(pending("preview", "show", "an embedded preview panel"));
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
