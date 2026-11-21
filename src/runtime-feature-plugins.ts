/**
 * The three feature plugins this release declares and a later one fills.
 *
 * One named factory, so the naming, the gating and the refusal live in one file a feature lane can
 * replace without touching the runtime: `runtime-plugins.ts` only spreads what this answers, and a
 * name that resolves to nothing never reaches the bridge, because every definition here exists or is
 * not returned. Each pending command answers `not-implemented` naming the release that fills it —
 * honest at the wire, and it keeps the documented capability action a real command name.
 */
import type { BrowserConfig, PreviewConfig, PtyConfig } from "@/config";
import { definePlugin, notImplemented, type PluginDefinition } from "@/plugins";

/** The config sections that opt a feature in. Each is optional; only `pty` gates registration. */
export interface FeatureSections {
	pty?: PtyConfig;
	preview?: PreviewConfig;
	browser?: BrowserConfig;
}

/** The release each feature ships in, in the order the docs page names them. */
const RELEASE = { pty: "0.2.9", preview: "0.2.10", browser: "0.2.11" } as const;

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
	if (sections.pty !== undefined) plugins.push(pending("pty", "open", "a terminal in the page"));
	plugins.push(pending("preview", "show", "an embedded preview panel"));
	// With no `browser` section this still registers and allows no origin; wave 2's plugin reads
	// `origins` and refuses every load rather than loading by default.
	plugins.push(pending("browser", "open", "an embedded browser surface"));
	return plugins;
}
