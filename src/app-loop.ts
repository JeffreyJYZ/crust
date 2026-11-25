/**
 * The pieces of an app run that need no `App` instance: the URL a window loads, the platform a bare `run()` imports, event fan-out, and the every-window-closed watch. Split out of `app.ts` so the class stays the lifecycle; every rule here was measured, so they travel with the code.
 */

import type { CrustConfig } from "@/config";
import type { DarwinPlatform } from "@/platform/darwin";
import { attachDeepLinkDelivery, configureDeepLink, queueDeepLink } from "./app-deep-link.ts";
import {
	type AppEvent,
	type AppListener,
	type LifecycleSource,
	PUMP_INTERVAL_MS,
	type Platform,
} from "./app-types.ts";
import {
	launchActivateMode,
	setActivationRaise,
	setTestingActivation,
} from "./plugins/activation-policy.ts";
import { defaultStateRoot } from "./plugins/window-persist-store.ts";

/** How often `run` checks whether every window has closed, when someone listens. */
const WINDOW_CHECK_INTERVAL_MS = 250;

export async function loadPlatform(config: CrustConfig): Promise<Platform> {
	// Before the platform exists: a probe's activation policy is what the first window create
	// reads, and `testing.activation` is honoured on every OS even though only macOS acts on it.
	setTestingActivation(config.testing?.activation);
	configureDeepLink(config);
	switch (process.platform) {
		case "darwin": {
			const darwin = await import("@/platform/darwin");
			// The one call `testing.activation: "on-demand"` may make, installed before any read.
			setActivationRaise((await import("@/platform/darwin/activation")).raiseAppOnce);
			return darwin.createPlatform({
				appName: config.app.name,
				activate: launchActivateMode(config.app.activate),
				icon: config.app.icon,
				microphone: config.security?.microphone !== undefined,
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
	setTestingActivation(config.testing?.activation);
	configureDeepLink(config);
	const darwin = await import("@/platform/darwin");
	setActivationRaise((await import("@/platform/darwin/activation")).raiseAppOnce);
	return darwin.createPlatform({
		appName: config.app.name,
		activate: launchActivateMode(config.app.activate),
		icon: config.app.icon,
		microphone: config.security?.microphone !== undefined,
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

/**
 * A deep link arrives before any page exists: the launch URL is claimed here, and the plugin's
 * `url()` answers it once a page asks. Nothing on a platform without the concept.
 */
export async function installLaunchDeepLink(): Promise<void> {
	if (process.platform !== "darwin") return;
	const link = await import("@/platform/darwin/deep-link");
	link.installDeepLinkHandler();
	attachDeepLinkDelivery();
	const launched = link.takeLaunchUrl();
	if (launched) queueDeepLink(launched);
	// A later URL is only stored by the native delegate. The C buffer is process-wide, so a fresh
	// adapter drains the same one the delegate filled; hand each URL to the app-wide sink on the
	// pump tick rather than letting it age there. The timer is unref'd: watching must not keep a
	// windowless app alive.
	const pending = link.darwinDeepLinkAdapter();
	const drain = setInterval(() => {
		const url = pending.takePendingUrl();
		if (!url) return;
		// `queueDeepLink` refuses malformed and foreign URLs itself; this catch is for a custom
		// link implementation that still throws, so one bad URL cannot kill the pump timer.
		try {
			queueDeepLink(url);
		} catch (error) {
			const text = error instanceof Error ? error.message : String(error);
			console.warn(`  deep-link refused ${JSON.stringify(url)}: ${text}`);
		}
	}, PUMP_INTERVAL_MS);
	drain.unref?.();
}

export { RESERVED_PLUGIN_NAMES, mountable } from "./plugins/mountable.ts";
export { LIFECYCLE_CHECK_INTERVAL_MS, watchLifecycle, watchWindows } from "./app-watch.ts";
/**
 * `windowUrl` and `openWindows` moved to `app-windows.ts` when the frame restore pushed this file
 * past the line cap; `watchWindows` and `watchLifecycle` moved to `app-watch.ts` when lifecycle
 * events did. Both are re-exported so every caller and test keeps importing them from here.
 */
export { openWindows, windowUrl } from "./app-windows.ts";
