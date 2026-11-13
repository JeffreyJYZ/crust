/**
 * The shared runtime: what `crust dev` spawns, and what a built app runs.
 *
 * One function, `startApp`, does the same five things in both:
 *
 *   1. load and validate the config
 *   2. attach the macOS platform and the config to the `app` singleton
 *   3. import the user's `main.ts` so it registers commands, mounts plugins and
 *      calls `run()`
 *   4. create the bridge on that first `run()`, with the core plugins, the
 *      mounted ones and one `app` namespace, so the handler table it snapshots
 *      already holds the project's plugins
 *   5. serve the page (the bridge injects its token; this module injects the
 *      one-name `invoke` shim DESIGN.md §5 promises)
 *
 * An invoke that matches no handler is the bridge's structured error, never a
 * crash: `app.invoke` throws a plain Error and the bridge serialises it.
 *
 * Run directly, this module IS the backend process:
 *
 *   bun run src/runtime.ts --config <path> --entry <path>
 */
import { dirname, join, resolve } from "node:path";
import { APP_NAMESPACE, app, type App, type CommandHandler } from "@/app.ts";
import { type AssetTable, type BridgeHandle, startBridge } from "@/bridge/server.ts";
import { type CrustConfig, loadConfig, validateConfig } from "@/config";
import type { DarwinPlatform } from "@/platform/darwin";
import { createWindowPlugin, type PluginDefinition, PluginRegistry, definePlugin } from "@/plugins";

export interface StartAppOptions {
	/** Config file, relative to the working directory. */
	configPath?: string;
	/** Backend entry, relative to the working directory. Defaults to `src/main.ts`. */
	entry?: string;
	/**
	 * A pre-bundled entry import. A built app's wrapper supplies this, because
	 * `import(<variable>)` cannot be resolved at build time; the wrapper's own
	 * literal `import("<entry>")` is what gets bundled into the binary.
	 */
	entryModule?: () => Promise<unknown>;
	/**
	 * An already-loaded config. A built app must take this path: its config was
	 * embedded at build time and no `crust.config.ts` exists on the user's disk.
	 */
	config?: CrustConfig;
	/** Frontend on disk. Defaults to `<project>/public` when that directory exists. */
	root?: string;
	/** Frontend embedded in the binary, ahead of `root`. */
	assets?: AssetTable;
	/** Skip the platform, for tests and for a headless bridge. */
	attachPlatform?: boolean;
}

/**
 * The page-side shim, installed after the bridge's own bootstrap.
 *
 * `installCrust` speaks `(plugin, command, args)`, which is what plugin calls
 * use. DESIGN.md §5 has the page call `invoke("greet", { name })` for an app
 * command, so a two-argument call is routed to the `app` namespace. A string
 * second argument is the explicit plugin form and passes through untouched.
 */
const INVOKE_SHIM = `<script>(function () {
	var api = window.crust;
	if (!api || typeof api.invoke !== "function") return;
	var raw = api.invoke.bind(api);
	api.invoke = function (name, command, args) {
		if (typeof command === "string") return raw(name, command, args);
		return raw("${APP_NAMESPACE}", "invoke", { name: name, args: command === undefined ? {} : command });
	};
})();</script>`;

/** Put the shim where the parser reaches it before any page script. */
function injectShim(html: string): string {
	const bodyOpen = /<body[^>]*>/i;
	if (bodyOpen.test(html)) return html.replace(bodyOpen, (tag) => `${tag}${INVOKE_SHIM}`);
	return `${INVOKE_SHIM}${html}`;
}

/** `crust:fs` -> `fs`; a bare `fs` is accepted too. */
function pluginName(entry: string): string {
	return entry.startsWith("crust:") ? entry.slice("crust:".length) : entry;
}

/** The core plugins the config asked for, or all four when it names none. */
function selectedPlugins(
	config: CrustConfig,
	core: readonly PluginDefinition[],
): PluginDefinition[] {
	if (!config.plugins || config.plugins.length === 0) return [...core];
	const wanted = config.plugins.map(pluginName);
	const known = core.map((plugin) => plugin.name);
	for (const name of wanted) {
		if (!known.includes(name)) {
			throw new Error(`crust: unknown plugin "${name}" — v1 ships ${known.join(", ")}`);
		}
	}
	return core.filter((plugin) => wanted.includes(plugin.name));
}

/**
 * Swap in the platform's native plugins.
 *
 * `dialog` and `window` are the two plugins with a native half in v1. Each
 * default export answers `not-implemented`; the real answer needs AppKit,
 * which arrives through that plugin's own `create*Plugin` hook. The window
 * plugin additionally needs the running platform to read labels from, which is
 * why it is appended here rather than living in `corePlugins`.
 *
 * No platform, or not macOS, means the honest answers stay: a headless bridge
 * and a non-macOS platform are unchanged, and the plugin is still registered
 * under its own name so `selectedPlugins` matches `config.plugins`.
 */
async function nativePlugins(
	core: readonly PluginDefinition[],
	platform: DarwinPlatform | undefined,
): Promise<PluginDefinition[]> {
	const { createDialogPlugin, createNotificationPlugin, createTrayPlugin } =
		await import("@/plugins");
	if (!platform || process.platform !== "darwin") {
		return [...core.filter((plugin) => plugin.name !== "window"), createWindowPlugin()];
	}
	const darwin = await import("@/platform/darwin");
	const notifications = await import("@/platform/darwin/notifications");
	const statusBar = await import("@/platform/darwin/status-bar");
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
		createWindowPlugin(darwin.darwinWindowAdapter(platform)),
	];
}

async function isDirectory(path: string): Promise<boolean> {
	try {
		return (await Bun.file(path).stat()).isDirectory();
	} catch {
		return false;
	}
}

/**
 * The backend entry: an explicit path must exist; otherwise `src/main.ts` then
 * `main.ts`, matching the CLI's rule so both entry points agree.
 */
async function resolveEntry(explicit: string | undefined): Promise<string | undefined> {
	if (explicit) {
		const path = resolve(explicit);
		return (await Bun.file(path).exists()) ? path : undefined;
	}
	for (const candidate of ["src/main.ts", "main.ts"]) {
		const path = resolve(candidate);
		if (await Bun.file(path).exists()) return path;
	}
	return undefined;
}

/** The document the bridge will serve, from the binary's assets or from disk. */ async function readIndex(
	root: string | undefined,
	assets?: AssetTable,
): Promise<string | undefined> {
	const embedded = assets?.["/index.html"];
	if (typeof embedded === "string") return embedded;
	if (!root) return undefined;
	const file = Bun.file(join(root, "index.html"));
	return (await file.exists()) ? await file.text() : undefined;
}

/**
 * Start a crust app. Resolves once the user's entry has run and `app.run()`
 * has opened its windows; the process then stays alive on the pump and the
 * bridge, which is the intended shape (there is no `run()` return to await).
 * The returned handle is the bridge that was started, so a test can stop it.
 */
let signalsRegistered = false;

/**
 * SIGINT/SIGTERM must end the process wherever `startApp` runs, including inside
 * a compiled binary where `import.meta.main` never fires. Guarded, so a second
 * call cannot install the handlers twice.
 */
function registerShutdownSignals(): void {
	if (signalsRegistered) return;
	signalsRegistered = true;
	for (const signal of ["SIGINT", "SIGTERM"] as const) {
		process.on(signal, () => process.exit(0));
	}
}

export async function startApp(options: StartAppOptions = {}): Promise<BridgeHandle> {
	registerShutdownSignals();
	const config =
		options.config !== undefined
			? validateConfig(options.config, "embedded config")
			: (await loadConfig({ configPath: options.configPath })).config;
	const projectDir = options.configPath ? dirname(resolve(options.configPath)) : process.cwd();
	const root = options.root ?? join(projectDir, "public");

	// The app namespace is the same object for every launch: commands registered
	// by main.ts after the bridge starts are still reachable, because the handler
	// closes over `app` rather than snapshotting its command table.
	const appPlugin = definePlugin({
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

	const core = (await import("@/plugins")).corePlugins;
	const attachPlatform = options.attachPlatform !== false;
	// The platform is built before the plugins because the window adapter reads
	// labels and native pointers from the same instance `app.attach` receives.
	// Constructing it starts nothing; `app.run()` calls `start()`.
	const darwinPlatform = attachPlatform ? await import("@/platform/darwin") : undefined;
	const platform = darwinPlatform?.createPlatform({ appName: config.app.name });
	const plugins = await nativePlugins(core, platform);

	const frontendRoot = (await isDirectory(root)) ? root : undefined;
	const indexHtml = await readIndex(frontendRoot, options.assets);

	// The bridge exists from the first `run()`, not from here, because it
	// snapshots its handler table at creation and the entry has not been
	// imported yet. Plugins the entry mounted therefore land in that table;
	// they sit after the built-ins, and the registry refuses a duplicate name,
	// so a namespace conflict is an error rather than a silent shadow.
	let bridge: BridgeHandle | undefined;
	const startBridgeFor = (runConfig: CrustConfig): BridgeHandle => {
		if (bridge !== undefined) return bridge;
		const registry = new PluginRegistry().register(
			...selectedPlugins(runConfig, plugins),
			...app.plugins(),
			appPlugin,
		);
		bridge = startBridge({
			handlers: registry,
			assets: options.assets,
			root: frontendRoot,
			indexHtml: indexHtml ? injectShim(indexHtml) : undefined,
			csp: runConfig.security?.csp,
		});
		console.log(
			`  bridge    ${bridge.url}${runConfig.dev?.url ? `  (page from ${runConfig.dev.url})` : ""}`,
		);
		return bridge;
	};

	app.deferBridge((runConfig) => startBridgeFor(runConfig).url);
	if (platform) app.attach(platform, config);

	const entry = options.entryModule;
	const entryPath = entry !== undefined ? undefined : await resolveEntry(options.entry);
	if (entry === undefined && entryPath === undefined) {
		throw new Error(`crust: no backend entry — expected src/main.ts or main.ts, or pass entry`);
	}

	try {
		if (entry !== undefined) await entry();
		else await import(entryPath as string);
	} catch (error) {
		await bridge?.stop();
		throw error;
	}

	// An entry that never calls `run()` still gets a bridge, and the fallback
	// keeps the old timing: it is listening by the time `startApp` resolves.
	return startBridgeFor(config);
}

/** The one argument parser both this module and the CLI accept. */
export function parseRuntimeArgs(argv: readonly string[]): { configPath?: string; entry?: string } {
	const parsed: { configPath?: string; entry?: string } = {};
	for (let index = 0; index < argv.length; index++) {
		const arg = argv[index];
		if (arg === "--config") parsed.configPath = argv[++index];
		else if (arg === "--entry") parsed.entry = argv[++index];
	}
	return parsed;
}

if (import.meta.main) {
	const args = parseRuntimeArgs(process.argv.slice(2));
	// `crust dev` restarts by killing this process, and a window closing kills it
	// from the platform side; both should end the process cleanly, not 130/143.
	registerShutdownSignals();
	startApp(args).catch((error: unknown) => {
		const text = error instanceof Error ? error.message : String(error);
		console.error(`crust: ${text}`);
		process.exitCode = 1;
	});
}

export type { BridgeHandle, CommandHandler, App };
