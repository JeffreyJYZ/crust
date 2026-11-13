/**
 * The shared runtime: what `crust dev` spawns, and what a built app runs.
 *
 * One function, `startApp`, does the same five things in both:
 *
 *   1. load and validate the config
 *   2. start the bridge with the four v1 plugins plus one `app` namespace
 *   3. attach the macOS platform and the bridge URL to the `app` singleton
 *   4. serve the page (the bridge injects its token; this module injects the
 *      one-name `invoke` shim DESIGN.md §5 promises)
 *   5. import the user's `main.ts` so it registers commands and calls `run()`
 *
 * An invoke that matches no handler is the bridge's structured error, never a
 * crash: `app.invoke` throws a plain Error and the bridge serialises it.
 *
 * Run directly, this module IS the backend process:
 *
 *   bun run src/runtime.ts --config <path> --entry <path>
 */
import { dirname, join, resolve } from "node:path";
import { app, type App, type CommandHandler } from "@/app.ts";
import { type AssetTable, type BridgeHandle, startBridge } from "@/bridge/server.ts";
import { type CrustConfig, loadConfig, validateConfig } from "@/config";
import { type PluginDefinition, PluginRegistry, definePlugin } from "@/plugins";

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

/** The `app` namespace: `window.crust.invoke("greet", { name })` lands here. */
const APP_NAMESPACE = "app";

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
 * `dialog` is the only core plugin with a native half in v1. Its default export
 * answers `not-implemented`; on macOS the real answer needs an AppKit adapter,
 * which arrives through the plugin's own `createDialogPlugin` hook. No adapter
 * means the honest answer stays, so a headless bridge and a non-macOS platform
 * are unchanged. The name is preserved, so `selectedPlugins` still matches it.
 */
async function nativePlugins(
	core: readonly PluginDefinition[],
	attachPlatform: boolean,
): Promise<PluginDefinition[]> {
	if (!attachPlatform || process.platform !== "darwin") return [...core];
	const [{ createDialogPlugin }, darwin] = await Promise.all([
		import("@/plugins"),
		import("@/platform/darwin"),
	]);
	return core.map((plugin) =>
		plugin.name === "dialog" ? createDialogPlugin(darwin.darwinDialogAdapter()) : plugin,
	);
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

export async function startApp(options: StartAppOptions = {}): Promise<void> {
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
	const plugins = await nativePlugins(core, attachPlatform);
	const registry = new PluginRegistry().register(...selectedPlugins(config, plugins), appPlugin);

	const frontendRoot = (await isDirectory(root)) ? root : undefined;
	const indexHtml = await readIndex(frontendRoot, options.assets);

	const bridge = startBridge({
		handlers: registry,
		assets: options.assets,
		root: frontendRoot,
		indexHtml: indexHtml ? injectShim(indexHtml) : undefined,
		csp: config.security?.csp,
	});

	console.log(
		`  bridge    ${bridge.url}${config.dev?.url ? `  (page from ${config.dev.url})` : ""}`,
	);

	if (attachPlatform) {
		const darwin = await import("@/platform/darwin");
		app.attach(darwin.createPlatform({ appName: config.app.name }), config, bridge.url);
	}

	const entry = options.entryModule;
	const entryPath = entry !== undefined ? undefined : await resolveEntry(options.entry);
	if (entry === undefined && entryPath === undefined) {
		await bridge.stop();
		throw new Error(`crust: no backend entry — expected src/main.ts or main.ts, or pass entry`);
	}

	try {
		if (entry !== undefined) await entry();
		else await import(entryPath as string);
	} catch (error) {
		await bridge.stop();
		throw error;
	}
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
