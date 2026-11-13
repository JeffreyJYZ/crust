/**
 * The public app surface.
 *
 * `main.ts` registers commands and listeners, then awaits `app.run()`. The
 * window machinery lives behind the `Platform` seam below, so the macOS
 * implementation can be plugged in without this file knowing AppKit exists.
 *
 * `run()` works two ways. Through `startApp` (both `crust dev` and a built app)
 * the platform, the config and the bridge URL are attached before `main.ts` is
 * imported. Called bare (`bun src/main.ts`) it loads both itself: the config
 * from the project directory and the platform through a lazy import, so the
 * macOS layer is not linked into a process that never opens a window.
 */
import { type CrustConfig, type WindowConfig, loadConfig } from "@/config";

/** Where a window points and how it is sized. Mirrors a config window entry. */
export interface WindowOptions {
	label: string;
	url?: string;
	width?: number;
	height?: number;
	minWidth?: number;
	title?: string;
}

/** A created window. The label is what `Platform.window(label)` looks it up by. */
export interface WindowHandle {
	label: string;
}

/**
 * The whole native surface crust depends on. One implementation per OS.
 *
 * `start` brings up the application; `pump` starts the Cocoa run loop pump on
 * a timer; `createWindow` opens a window; `window` returns it or undefined once
 * it has closed; `quit` ends the application.
 */
export interface Platform {
	start(): Promise<void>;
	pump(intervalMs: number): void;
	createWindow(options: WindowOptions): WindowHandle;
	window(label: string): WindowHandle | undefined;
	quit(): void;
}

export type AppEvent = "ready" | "window-all-closed";
export type AppListener = () => void | Promise<void>;
export type CommandHandler = (args: Record<string, unknown>) => unknown | Promise<unknown>;

/** Cocoa pump tick, from DESIGN.md §3: a 16 ms tick with a 0.25 ms slice holds. */
export const PUMP_INTERVAL_MS = 16;

/** How often `run` checks whether every window has closed, when someone listens. */
const WINDOW_CHECK_INTERVAL_MS = 250;

/**
 * An absolute URL is mandatory: the platform hands it to `NSURL` as-is, and a
 * relative one becomes `about:blank` there. `dev.url` wins verbatim (it is the
 * Vite origin), otherwise the window is served by the bridge.
 */
function windowUrl(
	window: WindowConfig,
	devUrl: string | undefined,
	bridgeUrl: string | undefined,
): string {
	const path = window.url ?? "/";
	if (devUrl) return devUrl;
	if (!bridgeUrl) {
		throw new Error(
			"crust: no page URL — set dev.url, or start through `crust dev` / a built app " +
				"so the bridge can serve the page",
		);
	}
	return `${bridgeUrl.replace(/\/+$/, "")}${path.startsWith("/") ? path : `/${path}`}`;
}

export class App {
	readonly #commands = new Map<string, CommandHandler>();
	readonly #listeners = new Map<AppEvent, Set<AppListener>>();
	#platform?: Platform;
	#config?: CrustConfig;
	#bridgeUrl?: string;
	#started = false;
	#closedNotified = false;
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

	/** Register the handler behind `invoke("<name>")` on the page side. */
	command(name: string, handler: CommandHandler): this {
		if (!name) throw new Error("crust: command name must not be empty");
		if (this.#commands.has(name))
			throw new Error(`crust: command "${name}" is already registered`);
		this.#commands.set(name, handler);
		return this;
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
	 * Start the platform, open the configured windows, emit `ready`, and hand
	 * the run loop to `pump`. Resolves once the app is up; the pump timer keeps
	 * the process alive afterwards.
	 *
	 * With nothing attached it loads the config from the working directory and
	 * imports the macOS platform on demand — the bare `bun src/main.ts` path.
	 */
	async run(): Promise<void> {
		if (this.#started) throw new Error("crust: app.run() was already called");
		const config = this.#config ?? (await loadConfig()).config;
		const platform = this.#platform ?? (await this.#loadPlatform(config));
		this.#config = config;
		this.#platform = platform;

		this.#started = true;
		await platform.start();
		for (const window of config.windows) {
			platform.createWindow({
				...window,
				url: windowUrl(window, config.dev?.url, this.#bridgeUrl),
			});
		}
		await this.#emit("ready");
		platform.pump(PUMP_INTERVAL_MS);

		if (this.#listeners.get("window-all-closed")?.size) this.#watchWindows(config, platform);
	}

	/** Quit the application, closing every window and stopping the pump timer. */
	quit(): void {
		this.#stopWatching();
		this.#platform?.quit();
	}

	/**
	 * The only dynamic import of the native layer. Keeping it lazy is what lets
	 * `bun check` and the bridge tests load this module on any machine, and why
	 * a process that never calls `run()` never compiles the shim.
	 */
	async #loadPlatform(config: CrustConfig): Promise<Platform> {
		if (process.platform !== "darwin") {
			throw new Error(`crust: no platform for ${process.platform} — macOS only for v1`);
		}
		const darwin = await import("@/platform/darwin");
		return darwin.createPlatform({ appName: config.app.name });
	}

	async #emit(event: AppEvent): Promise<void> {
		const listeners = this.#listeners.get(event);
		if (!listeners) return;
		for (const listener of listeners) await listener();
	}

	#watchWindows(config: CrustConfig, platform: Platform): void {
		this.#windowCheck = setInterval(() => {
			if (this.#closedNotified) return;
			const open = config.windows.some((window: WindowConfig) =>
				platform.window(window.label),
			);
			if (open) return;
			this.#closedNotified = true;
			void this.#emit("window-all-closed").then(() => platform.quit());
		}, WINDOW_CHECK_INTERVAL_MS);
		this.#windowCheck.unref?.();
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
