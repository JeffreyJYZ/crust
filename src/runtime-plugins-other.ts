/**
 * The plugin set a platform without a darwin layer registers: every OS except macOS, and also a
 * darwin run that attached no platform (a test, or an entry that never called `run()`).
 *
 * Split out of `runtime-plugins.ts` when that file reached the line cap, and because the two arms
 * differ in exactly one thing: whether the OS has a window adapter to wire. macOS wires
 * `darwinWindowAdapter`; Windows now wires its own; a platform with neither keeps the bare plugins,
 * which answer `not-implemented` by name instead of throwing at the first command.
 */
import type { FsConfig, ShellConfig, UpdaterConfig } from "@/config";
import type { FeatureSections } from "@/runtime-feature-plugins.ts";
import {
	createPositionerPlugin,
	createWindowPlugin,
	createWindowStatePlugin,
	type PluginDefinition,
} from "@/plugins";
import { coreNamespacePlugins, replacesCoreNamespace } from "@/runtime-adapters-other.ts";
import { nonDarwinPlugins, nonDarwinScreenPlugin } from "@/runtime-non-darwin";

/** The config sections that change which plugin an app gets. */
export interface NativePluginOptions extends FeatureSections {
	shell?: ShellConfig;
	updater?: UpdaterConfig;
	/** Filesystem scope: when set, every `fs` command must resolve inside it. */
	fs?: FsConfig;
	/** The app's id, which names its data directory: crash records, store and downloads live there. */
	app?: string;
}

/** A bare `ShellConfig` is the third argument `nativePlugins` took before `updater` existed. */
export function optionsOf(options: NativePluginOptions | ShellConfig): NativePluginOptions {
	const named = "shell" in options || "updater" in options || "app" in options;
	return named ? (options as NativePluginOptions) : { shell: options as ShellConfig };
}

/** The pieces `nativePlugins` has already built when it reaches this arm. */
export interface OtherPlatformParts {
	core: readonly PluginDefinition[];
	/** `fs` carries the config's scope, so the core four are rebuilt through this. */
	scoped: (plugin: PluginDefinition) => PluginDefinition;
	/** `i18n.load` reads a directory; this instance inherits the same boundary. */
	i18n: PluginDefinition;
	power: PluginDefinition;
	shell: PluginDefinition;
	sidecar: PluginDefinition;
	store: PluginDefinition;
	database: PluginDefinition;
	/** Per-app vault: the bare core plugin would share one machine-wide file. */
	stronghold: PluginDefinition;
	keychain: PluginDefinition;
	updater: readonly PluginDefinition[];
	/** `process.platform` in a real run; a parameter so the win32 arm is testable on macOS. */
	os: string;
	/** The app id and its data root, so window-state writes one file per app, not one per machine. */
	app: string | undefined;
	root: string;
}

/**
 * The namespaces an adapted arm replaces. `nonDarwinPlugins` still carries the bare `window-state`
 * and `positioner`, and the registry refuses a duplicate name rather than shadowing one, so each is
 * dropped when — and only when — an adapter was actually wired.
 *
 * `positioner` is in the set for Windows only: its nine placements are computed in AppKit's
 * bottom-left space, and `platform/windows/window-positioner.ts` converts them into Win32's y-down
 * work area. The Linux arm keeps the bare refusal, because GDK's top-left rectangles have no such
 * adapter yet.
 */
const ADAPTED = new Set(["window-state"]);
/** The Win32 arm's set: the state adapter plus the positioner that converts into the y-down axis. */
const ADAPTED_WIN32 = new Set([...ADAPTED, "positioner"]);

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
	const { core, scoped, os, app, root } = parts;
	const window = await windowPlugins(os, app, root);
	return [
		...core
			.filter((plugin) => plugin.name !== "window")
			.filter((plugin) => !replacesCoreNamespace(plugin.name, os))
			.map(scoped),
		...window.plugins,
		parts.power,
		// Displays have a working half on both platforms; the selector wires the right one.
		nonDarwinScreenPlugin(os),
		...nonDarwinPlugins.filter(
			(plugin) =>
				plugin.name !== "i18n" &&
				!window.replaced.has(plugin.name) &&
				!replacesCoreNamespace(plugin.name, os),
		),
		parts.i18n,
		// `clipboard`, `opener`, `os.info`, `notification` and `tray` with the platform's own adapter
		// where one exists; `runtime-adapters-other.ts` owns that choice, so a reconciliation touches
		// these two lines.
		...(await coreNamespacePlugins(os)),
		parts.store,
		parts.database,
		parts.stronghold,
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
async function windowPlugins(
	os: string,
	app: string | undefined,
	root: string,
): Promise<WindowWiring> {
	if (os === "linux") {
		const { activeLinuxPlatform } = await import("@/platform/linux/active-platform");
		const wiring = activeLinuxPlatform();
		if (wiring === undefined) return bare();
		const { linuxWindowAdapter } = await import("@/platform/linux/window-adapter");
		const { linuxWindowWorkAreas } = await import("@/platform/linux/screen");
		const native = linuxWindowAdapter(wiring.platform, wiring.native);
		return {
			plugins: [
				createWindowPlugin(native),
				createWindowStatePlugin({
					native,
					app,
					root,
					workAreas: linuxWindowWorkAreas,
				}),
			],
			replaced: ADAPTED,
		};
	}
	if (os !== "win32") return bare();
	const { windowsWindowAdapter } = await import("@/platform/windows/window-adapter");
	const { windowsWindowWorkAreas } = await import("@/platform/windows/screen");
	const { windowsPositioner } = await import("@/platform/windows/window-positioner");
	const native = windowsWindowAdapter();
	return {
		plugins: [
			createWindowPlugin(native),
			createWindowStatePlugin({
				native,
				app,
				root,
				workAreas: windowsWindowWorkAreas,
			}),
			// The nine placements, measured against the primary work area and flipped into Win32's
			// y-down axis by the adapter — the plugin's own arithmetic is untouched.
			createPositionerPlugin(windowsPositioner(native)),
		],
		replaced: ADAPTED_WIN32,
	};
}
