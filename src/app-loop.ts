/**
 * The pieces of an app run that need no `App` instance: the URL a window
 * loads, the platform a bare `run()` imports, event fan-out, and the
 * every-window-closed watch.
 *
 * Split out of `app.ts` so the class stays the lifecycle; every rule stated in
 * the comments here was measured, so they travel with the code.
 */

import { CrustError } from "@/bridge/errors";
import { type CrustConfig, type WindowConfig } from "@/config";
import { type PluginDefinition, definePlugin } from "./plugins/define.ts";
import { APP_NAMESPACE, type AppEvent, type AppListener, type Platform } from "./app-types.ts";
import { corePlugins, windowPlugin } from "./plugins/index.ts";

/** How often `run` checks whether every window has closed, when someone listens. */
const WINDOW_CHECK_INTERVAL_MS = 250;

/**
 * Names a project plugin may not claim.
 *
 * The core four are `corePlugins`; `window` is appended by `startApp` and is
 * therefore not in that list; `app` is the runtime's own namespace. A name is a
 * namespace, so a duplicate is an overlap in the handler table rather than an
 * override — refused instead of silently shadowing a built-in.
 */
export const RESERVED_PLUGIN_NAMES: ReadonlySet<string> = new Set([
	APP_NAMESPACE,
	windowPlugin.name,
	...corePlugins.map((plugin) => plugin.name),
]);

/**
 * An absolute URL is mandatory: the platform hands it to `NSURL` as-is, and a
 * relative one becomes `about:blank` there. `dev.url` wins verbatim (it is the
 * Vite origin), otherwise the window is served by the bridge.
 */
export function windowUrl(
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

/**
 * The only dynamic import of the native layer. Keeping it lazy is what lets
 * `bun check` and the bridge tests load `app.ts` on any machine, and why a
 * process that never calls `run()` never compiles the shim.
 */
export async function loadPlatform(config: CrustConfig): Promise<Platform> {
	if (process.platform !== "darwin") {
		throw new Error(`crust: no platform for ${process.platform} — macOS only for v1`);
	}
	const darwin = await import("@/platform/darwin");
	return darwin.createPlatform({ appName: config.app.name });
}

/** Wake every listener of one event, in order, awaiting each. */
export async function emit(
	listeners: Map<AppEvent, Set<AppListener>>,
	event: AppEvent,
): Promise<void> {
	const set = listeners.get(event);
	if (!set) return;
	for (const listener of set) await listener();
}

/** Create every configured window and say so, so a silent window is visible. */ export function openWindows(
	platform: Platform,
	config: CrustConfig,
	bridgeUrl: string | undefined,
): void {
	for (const window of config.windows) {
		platform.createWindow({
			...window,
			url: windowUrl(window, config.dev?.url, bridgeUrl),
		});
		// A window that exists but never appears is the worst failure: the page runs, the
		// bridge answers, and the screen is empty. Say what was created so a silent window
		// is visible in the log rather than inferred from a user's "nothing happened".
		console.log(`  window    ${window.label} created`);
	}
}

/**
 * Check that a project plugin may be mounted, and freeze it the way
 * `definePlugin` would.
 *
 * `definePlugin` already checks the shape, so this adds the two rules a mount
 * needs: the name is a namespace and must be unused — a duplicate, a built-in
 * name (`fs`, `dialog`, `notification`, `tray`, `window`) or the reserved `app`
 * namespace is refused, never shadowed — and the mount must happen before
 * `run()`, which the caller checks because it owns the started flag.
 */
export function mountable(
	plugin: PluginDefinition,
	mounted: ReadonlyMap<string, PluginDefinition>,
): PluginDefinition {
	if (typeof plugin !== "object" || plugin === null)
		throw new CrustError(
			"bad-request",
			"app.use: not a plugin definition (expected { name, commands })",
		);

	const definition = definePlugin(plugin);
	const name = definition.name;
	if (name === APP_NAMESPACE) {
		throw new CrustError("bad-request", `app.use: "${name}" is the reserved app namespace`);
	}
	if (RESERVED_PLUGIN_NAMES.has(name)) {
		throw new CrustError(
			"bad-request",
			`app.use: "${name}" is a built-in plugin — a name is a namespace, so pick another`,
		);
	}
	if (mounted.has(name)) {
		throw new CrustError("bad-request", `app.use: plugin "${name}" is already mounted`);
	}
	return definition;
}

/**
 * Watch for every configured window closing, once. The returned handle is the
 * timer the app clears on `quit()`, and it never keeps the process alive by
 * itself.
 */
export function watchWindows(
	config: CrustConfig,
	platform: Platform,
	onAllClosed: () => void,
): ReturnType<typeof setInterval> {
	let notified = false;
	const handle = setInterval(() => {
		if (notified) return;
		const open = config.windows.some((window: WindowConfig) => platform.window(window.label));
		if (open) return;
		notified = true;
		onAllClosed();
	}, WINDOW_CHECK_INTERVAL_MS);
	handle.unref?.();
	return handle;
}
