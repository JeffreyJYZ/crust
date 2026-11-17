/**
 * The shared runtime: what `crust dev` spawns and what a built app runs. One `startApp` loads and validates the config, attaches the platform and config to the `app` singleton, imports the user's `main.ts`, creates the bridge on its first `run()` (core plugins, mounted ones, one `app` namespace) and serves the page with the injected token and `invoke` shim.
 * An invoke that matches no handler is the bridge's structured error, never a crash. Pieces: `runtime-shim.ts`, `runtime-plugins.ts`, `runtime-host.ts`. Run directly it IS the backend: `bun run src/runtime.ts --config <path> --entry <path>`.
 */
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { app, type App, type CommandHandler, type Platform } from "@/app.ts";
import { loadDarwinPlatform, loadPlatform } from "./app-loop.ts";
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
import { runCrashGuardIfMarked } from "./runtime-crash-guard.ts";
import { createAppNamespacePlugin, nativePlugins } from "./runtime-plugins.ts";
import { parseRuntimeArgs, registerShutdownSignals } from "./runtime-process.ts";
import { claimSingleInstance, quitSecondInstance } from "./runtime-single.ts";
import { injectShim, selectedPlugins } from "./runtime-shim.ts";
import { BRIDGE_TOKEN_VAR, BRIDGE_URL_VAR } from "@/vite.ts";
import { setBridgeToken } from "@/bridge/window-identity.ts";
import type { StartAppOptions } from "./runtime-options.ts";

export type { StartAppOptions } from "./runtime-options.ts";

/**
 * Start a crust app. Resolves once the user's entry has run and `app.run()`
 * has opened its windows; the process then stays alive on the pump and the
 * bridge, which is the intended shape (there is no `run()` return to await).
 * The returned handle is the bridge that was started, so a test can stop it.
 */
export async function startApp(options: StartAppOptions = {}): Promise<BridgeHandle> {
	// The guard is this executable launched a second time, so its launch reaches this entry too.
	// Read the marker before the single-instance lock and before any config: a guard is not a
	// second copy of the app, and it must open no window and bind no port.
	if (await runCrashGuardIfMarked()) process.exit(0);
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
	// One running copy per app id: the lock is claimed before the platform
	// exists, so a second launch raises the copy already running and never
	// builds AppKit, imports the entry, or opens a window.
	const single = await claimSingleInstance({ config, attachPlatform });
	if (!single.acquired) {
		await quitSecondInstance(single.pid, { activate: single.activate });
		process.exit(0);
	}
	// The platform is built before the plugins because the window adapter reads
	// labels and native pointers from the same instance `app.attach` receives.
	// Constructing it starts nothing; `app.run()` calls `start()`.
	// Darwin is selected first because `nativePlugins` reads Darwin-only members;
	// every other OS takes the `loadPlatform` arm, which is what `app.run()` uses.
	const darwinPlatform: DarwinPlatform | undefined =
		attachPlatform && process.platform === "darwin"
			? await loadDarwinPlatform(config)
			: undefined;
	const platform: Platform | undefined =
		darwinPlatform ?? (attachPlatform ? await loadPlatform(config) : undefined);
	const plugins = [
		...(await nativePlugins(core, darwinPlatform, {
			shell: config.shell,
			updater: config.updater,
			fs: config.fs,
			app: config.app.id,
		})),
		single.plugin,
	];

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
		const registry = (options.registry ?? new PluginRegistry()).register(
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
					// The capability table is compiled once inside `startBridge`; the config section
					// goes in whole so the bridge itself decides what "absent" means.
					security: runConfig.security,
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
				// 0600: the file carries the bearer token, and without an explicit mode it inherits
				// the process umask (commonly 0644), so every local account on a shared machine
				// could read it and drive every bridge command. The mode applies only on creation,
				// so an existing file from an earlier run is tightened by the `chmod`.
				const handshake = join(handshakeDir, "dev.json");
				writeFileSync(handshake, JSON.stringify({ url: bridge.url, token: bridge.token }), {
					mode: 0o600,
				});
				chmodSync(handshake, 0o600);
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
		// `window.create` builds a document URL from inside the window plugin, where no bridge handle
		// is in scope. Recording the token here covers every start path — the deferred factory below
		// and the fallback for an entry that never calls `run()`. Under `crust dev` a created window
		// resolves against the Vite page, which injects its own `__CRUST__`, so nothing is recorded
		// there: publishing the token into a Vite-served URL would only put it in the dev server log.
		setBridgeToken(runConfig.dev?.url ? undefined : bridge.token, bridge.url);
		return bridge;
	};

	app.deferBridge((runConfig) => {
		const started = startBridgeFor(runConfig);
		return { url: started.url, token: started.token };
	});
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
