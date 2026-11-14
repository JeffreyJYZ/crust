/**
 * The public app surface: `main.ts` registers commands, mounts plugins and adds listeners, then awaits `app.run()`. The window machinery stays behind the `Platform` seam in `app-types.ts`, so macOS plugs in without this file knowing AppKit exists.
 * Through `startApp` (dev and built apps) the platform and config are attached before `main.ts` is imported and the bridge is created on the first `run()`, so a plugin mounted there is in the table the bridge snapshots; called bare (`bun src/main.ts`) it loads both itself, importing the platform lazily so macOS is not linked into a process that never opens a window.
 */
import { CrustError } from "@/bridge/errors";
import { type CrustConfig, loadConfig } from "@/config";
import { emit, loadPlatform, mountable, openWindows, watchWindows } from "./app-loop.ts";
import {
	APP_NAMESPACE,
	type AppEvent,
	type AppListener,
	type BridgeFactory,
	type CommandHandler,
	PUMP_INTERVAL_MS,
	type Platform,
} from "./app-types.ts";
import { type PluginDefinition } from "./plugins/define.ts";

export * from "./app-types.ts";

export class App {
	readonly #commands = new Map<string, CommandHandler>();
	readonly #plugins = new Map<string, PluginDefinition>();
	readonly #listeners = new Map<AppEvent, Set<AppListener>>();
	#platform?: Platform;
	#config?: CrustConfig;
	#bridgeUrl?: string;
	#bridgeFactory?: BridgeFactory;
	#started = false;
	#windowCheck?: ReturnType<typeof setInterval>;

	/**
	 * Wire the native platform and the loaded config into this app instance.
	 * `startApp` calls this before importing the user's `main.ts`; tests call it
	 * with a fake platform, and `bridgeUrl` is what a page needs to load.
	 */
	attach(platform: Platform, config: CrustConfig, bridgeUrl?: string): this {
		if (this.#started) throw new Error("crust: cannot attach a platform to a running app");
		this.#platform = platform;
		this.#config = config;
		if (bridgeUrl !== undefined) this.#bridgeUrl = bridgeUrl;
		return this;
	}

	/**
	 * Hand this instance the config without a platform. A built app's wrapper already carries it and imports the backend through `entryModule`, so there is no working directory to load from — a launched `.app` runs with `/` as cwd. Without this, `app.run()` fell back to `loadConfig()` and died with `no crust config in /` for any app started outside its project directory.
	 */
	configure(config: CrustConfig): this {
		if (this.#started) throw new Error("crust: cannot configure a running app");
		this.#config = config;
		return this;
	}

	/**
	 * Create the bridge on the first `run()` instead of now: `startApp` calls this before importing the entry, because the bridge snapshots its `"<plugin>.<command>"` table at creation and a plugin mounted there must already be registered. Runs at most once; returns the URL the windows load.
	 */
	deferBridge(factory: BridgeFactory): this {
		if (this.#started) throw new Error("crust: cannot start a bridge for a running app");
		this.#bridgeFactory = factory;
		return this;
	}

	/** Register the handler behind `invoke("<name>")` on the page side. */
	command(name: string, handler: CommandHandler): this {
		if (!name) throw new Error("crust: command name must not be empty");
		if (this.#started)
			throw new Error(`crust: cannot register command "${name}" after app.run() has started`);
		if (this.#commands.has(name))
			throw new Error(`crust: command "${name}" is already registered`);
		this.#commands.set(name, handler);
		return this;
	}

	/**
	 * Mount a plugin of your own, so a page reaches it as
	 * `window.crust.invoke("<name>", "<command>", args)`. The name is a namespace, so a
	 * duplicate, a built-in or the reserved `app` is refused rather than shadowed
	 * (`mountable` owns those rules), and the mount must happen before `run()`.
	 */
	use(plugin: PluginDefinition): this {
		if (this.#started)
			throw new Error("crust: cannot mount a plugin after app.run() has started");
		const definition = mountable(plugin, this.#plugins);
		this.#plugins.set(definition.name, definition);
		return this;
	}

	/** Every mounted plugin, in mount order. `startApp` registers these last. */
	plugins(): readonly PluginDefinition[] {
		return [...this.#plugins.values()];
	}

	/** Listen for an app event. */
	on(event: AppEvent, listener: AppListener): this {
		const set = this.#listeners.get(event) ?? new Set<AppListener>();
		set.add(listener);
		this.#listeners.set(event, set);
		return this;
	}

	/**
	 * Resolve a command for the bridge. The bridge passes the page's payload
	 * through unchanged; an unknown name is an error, never a silent undefined.
	 */
	async invoke(name: string, args: Record<string, unknown> = {}): Promise<unknown> {
		const handler = this.#commands.get(name);
		if (!handler) throw new Error(`crust: unknown command "${name}"`);
		return await handler(args);
	}

	/**
	 * Start the platform, open the configured windows, emit `ready` and hand the run loop to `pump`. Resolves once the app is up; the pump timer keeps the process alive. With nothing attached it loads the config from the working directory and imports macOS on demand — the bare `bun src/main.ts` path.
	 */
	async run(): Promise<void> {
		if (this.#started) throw new Error("crust: app.run() was already called");
		const config = this.#config ?? (await loadConfig()).config;
		const platform = this.#platform ?? (await loadPlatform(config));
		this.#config = config;
		this.#platform = platform;
		// A deferred bridge starts here, after the entry's plugins and commands
		// are registered and before the first window is created.
		if (this.#bridgeUrl === undefined && this.#bridgeFactory !== undefined) {
			this.#bridgeUrl = this.#bridgeFactory(config);
		}

		this.#started = true;
		await platform.start();
		openWindows(platform, config, this.#bridgeUrl);
		await emit(this.#listeners, "ready");
		platform.pump(PUMP_INTERVAL_MS);

		if (this.#listeners.get("window-all-closed")?.size) {
			this.#windowCheck = watchWindows(config, platform, () => {
				void emit(this.#listeners, "window-all-closed").then(() => platform.quit());
			});
		}
	}

	/** Quit the application, closing every window and stopping the pump timer. */
	quit(): void {
		this.#stopWatching();
		this.#platform?.quit();
	}

	#stopWatching(): void {
		if (this.#windowCheck) clearInterval(this.#windowCheck);
		this.#windowCheck = undefined;
	}
}

/** Build an app bound to a platform and config. */
export function createApp(platform: Platform, config: CrustConfig, bridgeUrl?: string): App {
	return new App().attach(platform, config, bridgeUrl);
}

/**
 * The singleton `main.ts` imports as `import { app } from "crust"`.
 * It is inert until the platform and config are attached.
 */
export const app = new App();
