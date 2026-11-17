/**
 * The pieces of an app run that need no `App` instance: the URL a window loads, the platform a bare `run()` imports, event fan-out, and the every-window-closed watch. Split out of `app.ts` so the class stays the lifecycle; every rule here was measured, so they travel with the code.
 */

import { CrustError } from "@/bridge/errors";
import type { BridgeTarget } from "@/bridge/server.ts";
import { withToken, withWindowLabel } from "@/bridge/window-identity.ts";
import { type CrustConfig, type WindowConfig } from "@/config";
import type { DarwinPlatform } from "@/platform/darwin";
import { type PluginDefinition, definePlugin } from "./plugins/define.ts";
import {
	APP_NAMESPACE,
	type AppEvent,
	type AppListener,
	type LifecycleSource,
	type Platform,
} from "./app-types.ts";
import { corePlugins, windowPlugin } from "./plugins/index.ts";
import { defaultStateRoot } from "./plugins/window-persist-store.ts";

/** How often `run` checks whether every window has closed, when someone listens. */
const WINDOW_CHECK_INTERVAL_MS = 250;

/**
 * Names a project plugin may not claim. The core four are `corePlugins`; `window` is appended by `startApp` and is not in that list; `app` is the runtime's namespace. A name is a namespace, so a duplicate overlaps the handler table rather than overriding — refused, never silently shadowed.
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
 *
 * The document carries the window's identity: `?window=<label>` is appended
 * when the configured URL names no window, so the page reads its own label back
 * from `location.search` and the bridge can inject it into the client. A URL
 * that already names its own `window` is left byte-exact.
 *
 * A bridge-served URL also carries `?token=<token>`: the document route refuses a request that
 * cannot present one, so a page fetched without it is a `401` — and a local process fetching `/`
 * never receives the credential. A dev-server page is served by Vite, so it needs no token.
 */
export function windowUrl(
	window: WindowConfig,
	devUrl: string | undefined,
	bridge: BridgeTarget | undefined,
): string {
	const path = window.url ?? "/";
	if (devUrl) return withWindowLabel(devUrl, window.label);
	if (!bridge) {
		throw new Error(
			"crust: no page URL — set dev.url, or start through `crust dev` / a built app " +
				"so the bridge can serve the page",
		);
	}
	const url = `${bridge.url.replace(/\/+$/, "")}${path.startsWith("/") ? path : `/${path}`}`;
	return withToken(withWindowLabel(url, window.label), bridge.token);
}

/**
 * The only dynamic import of the native layer. Keeping it lazy is what lets
 * `bun check` and the bridge tests load `app.ts` on any machine, and why a
 * process that never calls `run()` never compiles the shim.
 * One arm per OS, each importing its own barrel, so a Linux launch never loads AppKit and a macOS launch never loads GTK.
 */
export async function loadPlatform(config: CrustConfig): Promise<Platform> {
	switch (process.platform) {
		case "darwin": {
			const darwin = await import("@/platform/darwin");
			return darwin.createPlatform({
				appName: config.app.name,
				activate: config.app.activate,
				icon: config.app.icon,
			});
		}
		case "linux": {
			// The whole config, because the Linux platform reads the window list;
			// darwin takes the name and the `app.activate` policy.
			const linux = await import("@/platform/linux");
			return linux.createPlatform(config);
		}
		case "win32": {
			// `WindowsPlatformConfig` is `{ appName, userDataDir }`, so the whole config
			// rides along and the name their window class reads is added beside it —
			// passing the bare config would register every app as "crust".
			// `userDataDir` is derived, not configured: WebView2 keeps cookies and profile state
			// there, and two crust apps launched from one machine would otherwise share one folder
			// when they happened to be built under the same executable name. It is the same
			// per-app root the store, crash records and window state already use.
			const windows = await import("@/platform/windows");
			return windows.createPlatform({
				...config,
				appName: config.app.name,
				userDataDir: defaultStateRoot(config.app.id),
			});
		}
		default:
			throw new Error(
				`crust: no platform for ${process.platform} — macOS, Linux and Windows for now`,
			);
	}
}

/**
 * The macOS platform alone. The plugin layer reads Darwin-only members off it, so
 * `runtime.ts` needs the narrower type; every other OS reaches its platform
 * through `loadPlatform`, which is the same call with a wider return.
 */
export async function loadDarwinPlatform(config: CrustConfig): Promise<DarwinPlatform> {
	const darwin = await import("@/platform/darwin");
	return darwin.createPlatform({
		appName: config.app.name,
		activate: config.app.activate,
		icon: config.app.icon,
	});
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
	bridge: BridgeTarget | undefined,
): void {
	for (const window of config.windows) {
		platform.createWindow({
			...window,
			url: windowUrl(window, config.dev?.url, bridge),
		});
		// A window that exists but never appears is the worst failure: the page runs, the
		// bridge answers, and the screen is empty. Say what was created so a silent window
		// is visible in the log rather than inferred from a user's "nothing happened".
		console.log(`  window    ${window.label} created`);
	}
}

/**
 * Check that a project plugin may be mounted, and freeze it the way `definePlugin` would. `definePlugin` already checks the shape, so this adds the two rules a mount needs: the name is a namespace and must be unused (a duplicate, a built-in or the reserved `app` is refused, never shadowed), and the mount happens before `run()`, which the caller checks because it owns the started flag.
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
 * `watchWindows` and `watchLifecycle` moved to `app-watch.ts` — this file crossed the 200-line cap
 * when lifecycle events landed, and the fix for a cap is another file. Re-exported so every caller
 * and test keeps importing them from here.
 */
export { LIFECYCLE_CHECK_INTERVAL_MS, watchLifecycle, watchWindows } from "./app-watch.ts";
