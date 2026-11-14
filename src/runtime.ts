/**
 * The shared runtime: what `crust dev` spawns and what a built app runs. One `startApp` loads and validates the config, attaches the platform and config to the `app` singleton, imports the user's `main.ts`, creates the bridge on its first `run()` (core plugins, mounted ones, one `app` namespace) and serves the page with the injected token and `invoke` shim.
 * An invoke that matches no handler is the bridge's structured error, never a crash. Pieces: `runtime-shim.ts`, `runtime-plugins.ts`, `runtime-host.ts`. Run directly it IS the backend: `bun run src/runtime.ts --config <path> --entry <path>`.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { app, type App, type CommandHandler } from "@/app.ts";
import { type AssetTable, type BridgeHandle, startBridge } from "@/bridge/server.ts";
import { type CrustConfig, loadConfig, validateConfig } from "@/config";
import { type DarwinPlatform } from "@/platform/darwin";
import { PluginRegistry } from "@/plugins";
import {
	isDirectory,
	preferredPortFor,
	readIndex,
	resolveEntry,
	originOf,
} from "./runtime-host.ts";
import { createAppNamespacePlugin, nativePlugins } from "./runtime-plugins.ts";
import { parseRuntimeArgs, registerShutdownSignals } from "./runtime-process.ts";
import { injectShim, selectedPlugins } from "./runtime-shim.ts";
import { BRIDGE_TOKEN_VAR, BRIDGE_URL_VAR } from "@/vite.ts";

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
 * Start a crust app. Resolves once the user's entry has run and `app.run()`
 * has opened its windows; the process then stays alive on the pump and the
 * bridge, which is the intended shape (there is no `run()` return to await).
 * The returned handle is the bridge that was started, so a test can stop it.
 */
export async function startApp(options: StartAppOptions = {}): Promise<BridgeHandle> {
	registerShutdownSignals();
	const config =
		options.config !== undefined
			? validateConfig(options.config, "embedded config")
			: (await loadConfig({ configPath: options.configPath })).config;
	const projectDir = options.configPath ? dirname(resolve(options.configPath)) : process.cwd();
	const root = options.root ?? join(projectDir, "public");

	const appPlugin = createAppNamespacePlugin();

	const core = (await import("@/plugins")).corePlugins;
	const attachPlatform = options.attachPlatform !== false;
	// The platform is built before the plugins because the window adapter reads
	// labels and native pointers from the same instance `app.attach` receives.
	// Constructing it starts nothing; `app.run()` calls `start()`.
	const darwinPlatform = attachPlatform ? await import("@/platform/darwin") : undefined;
	const platform: DarwinPlatform | undefined = darwinPlatform?.createPlatform({
		appName: config.app.name,
	});
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
		const preferred = preferredPortFor(runConfig.app.id);
		let bindError: unknown;
		for (let offset = 0; offset <= 20; offset++) {
			try {
				bridge = startBridge({
					handlers: registry,
					assets: options.assets,
					root: frontendRoot,
					indexHtml: indexHtml ? injectShim(indexHtml) : undefined,
					csp: runConfig.security?.csp,
					devOrigin: runConfig.dev?.url ? originOf(runConfig.dev.url) : undefined,
					// Walk upward from the app's stable port; the last attempt lets the
					// OS pick, so a machine with no free port still starts.
					port: offset === 20 ? 0 : preferred + offset,
				});
				bindError = undefined;
				break;
			} catch (error) {
				bindError = error;
			}
		}
		if (!bridge) throw bindError ?? new Error("crust: the bridge could not bind a port");
		// The handshake only exists for a dev server, which a built app never has.
		// A built app runs with cwd `/`, so writing it there would throw and kill
		// `run()` before a window exists — measured as e2e's missing greet.
		if (runConfig.dev?.url) {
			try {
				const handshakeDir = join(projectDir, ".crust");
				mkdirSync(handshakeDir, { recursive: true });
				writeFileSync(
					join(handshakeDir, "dev.json"),
					JSON.stringify({ url: bridge.url, token: bridge.token }),
				);
				process.env[BRIDGE_URL_VAR] = bridge.url;
				process.env[BRIDGE_TOKEN_VAR] = bridge.token;
			} catch (error) {
				const reason = error instanceof Error ? error.message : String(error);
				console.warn(`  bridge    could not publish the dev handshake: ${reason}`);
			}
		}
		console.log(
			`  bridge    ${bridge.url}${runConfig.dev?.url ? `  (page from ${runConfig.dev.url})` : ""}`,
		);
		return bridge;
	};

	app.deferBridge((runConfig) => startBridgeFor(runConfig).url);
	if (platform) app.attach(platform, config);
	else app.configure(config);

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
export { parseRuntimeArgs } from "./runtime-process.ts";

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
