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
 * The one namespace an adapted arm replaces. `nonDarwinPlugins` still carries the bare
 * `window-state`, and the registry refuses a duplicate name rather than shadowing one, so it is
 * dropped when — and only when — an adapter was actually wired. `positioner` is *not* in this set:
 * its nine placements are computed in AppKit's bottom-left space, so on a y-down platform (Win32's
 * client origin, GDK's top-left rectangles) it keeps its bare refusal rather than placing windows on
 * the wrong edge. Making it honest needs an axis option in `src/plugins/positioner.ts`, not a flip
 * here.
 */
const ADAPTED = new Set(["window-state"]);

/** What an OS arm produced: the plugins to register, and the bare names it replaced. */
interface WindowWiring {
	plugins: PluginDefinition[];
	/** Dropped from `nonDarwinPlugins`, so no namespace is registered twice. */
	replaced: ReadonlySet<string>;
}

/** No adapter: the bare plugin, and nothing replaced. */
function bare(): WindowWiring {
	return { plugins: [createWindowPlugin()], replaced: new Set() };
}

export async function otherPlatformPlugins(parts: OtherPlatformParts): Promise<PluginDefinition[]> {
	const { core, scoped, os } = parts;
	const window = await windowPlugins(os);
	return [
		...core.filter((plugin) => plugin.name !== "window").map(scoped),
		...window.plugins,
		parts.power,
		// Displays have a working half on both platforms; the selector wires the right one.
		nonDarwinScreenPlugin(os),
		...nonDarwinPlugins.filter((plugin) => !window.replaced.has(plugin.name)),
		parts.store,
		parts.database,
		parts.keychain,
		parts.shell,
		parts.sidecar,
		...parts.updater,
	];
}

/**
 * `window` and `window-state` for this OS, plus the bare names replaced. Each adapter is imported
 * lazily so a Linux launch never loads the Win32 shim's source and the reverse. The platform arrives
 * through its own `active-platform` module, because `runtime.ts` hands this registry only the darwin
 * platform; a Linux run with no platform built yet (a test, or an entry that never called `run()`)
 * keeps the bare refusal instead of half-wiring a namespace.
 */
async function windowPlugins(os: string): Promise<WindowWiring> {
	if (os === "linux") {
		const { activeLinuxPlatform } = await import("@/platform/linux/active-platform");
		const wiring = activeLinuxPlatform();
		if (wiring === undefined) return bare();
		const { linuxWindowAdapter } = await import("@/platform/linux/window-adapter");
		const native = linuxWindowAdapter(wiring.platform, wiring.native);
		return {
			plugins: [createWindowPlugin(native), createWindowStatePlugin({ native })],
			replaced: ADAPTED,
		};
	}
	if (os !== "win32") return bare();
	const { windowsWindowAdapter } = await import("@/platform/windows/window-adapter");
	const native = windowsWindowAdapter();
	return {
		plugins: [createWindowPlugin(native), createWindowStatePlugin({ native })],
		replaced: ADAPTED,
	};
}
