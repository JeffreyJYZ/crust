/**
 * The plugin set a platform without a darwin layer registers: every OS except macOS, and also a
 * darwin run that attached no platform (a test, or an entry that never called `run()`).
 *
 * Split out of `runtime-plugins.ts` when that file reached the line cap, and because the two arms
 * differ in exactly one thing: whether the OS has a window adapter to wire. macOS wires
 * `darwinWindowAdapter`; Windows now wires its own; a platform with neither keeps the bare plugins,
 * which answer `not-implemented` by name instead of throwing at the first command.
 */
import { createWindowPlugin, createWindowStatePlugin, type PluginDefinition } from "@/plugins";
import { nonDarwinPlugins, nonDarwinScreenPlugin } from "@/runtime-non-darwin";

/** The pieces `nativePlugins` has already built when it reaches this arm. */
export interface OtherPlatformParts {
	core: readonly PluginDefinition[];
	/** `fs` carries the config's scope, so the core four are rebuilt through this. */
	scoped: (plugin: PluginDefinition) => PluginDefinition;
	power: PluginDefinition;
	shell: PluginDefinition;
	sidecar: PluginDefinition;
	store: PluginDefinition;
	database: PluginDefinition;
	keychain: PluginDefinition;
	updater: readonly PluginDefinition[];
	/** `process.platform` in a real run; a parameter so the win32 arm is testable on macOS. */
	os: string;
}

/**
 * The one namespace the win32 arm replaces with an adapted instance. `nonDarwinPlugins` still carries
 * the bare `window-state`, and the registry refuses a duplicate name rather than shadowing one, so it
 * is dropped here instead of being registered twice. `positioner` is *not* in this set: its nine
 * placements are computed in AppKit's bottom-left space, so it keeps its bare refusal on a y-down
 * platform rather than placing windows on the wrong edge.
 */
const ADAPTED = new Set(["window-state"]);

export async function otherPlatformPlugins(parts: OtherPlatformParts): Promise<PluginDefinition[]> {
	const { core, scoped, os } = parts;
	const window = await windowPlugins(os);
	return [
		...core.filter((plugin) => plugin.name !== "window").map(scoped),
		...window,
		parts.power,
		// Displays have a working half on both platforms; the selector wires the right one.
		nonDarwinScreenPlugin(os),
		...nonDarwinPlugins.filter((plugin) => !(os === "win32" && ADAPTED.has(plugin.name))),
		parts.store,
		parts.database,
		parts.keychain,
		parts.shell,
		parts.sidecar,
		...parts.updater,
	];
}

/**
 * `window` and `window-state` for this OS. The Windows adapter is imported lazily so a Linux launch
 * never loads the Win32 shim's source, and resolved through `activeWindowsPlatform` rather than a
 * parameter because `runtime.ts` hands this registry only the darwin platform.
 */
async function windowPlugins(os: string): Promise<PluginDefinition[]> {
	if (os !== "win32") return [createWindowPlugin()];
	const { windowsWindowAdapter } = await import("@/platform/windows/window-adapter");
	const native = windowsWindowAdapter();
	return [createWindowPlugin(native), createWindowStatePlugin({ native })];
}
