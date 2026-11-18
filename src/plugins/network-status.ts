/**
 * The connectivity half of `crust:network`: `status()` and the `network:change` push. Butter answers
 * "is this machine online" with a HTTP probe; crust asks the operating system instead, because a
 * probe cannot tell a captive portal or a refused DNS answer from an offline machine.
 *
 * Kept apart from the interception commands on purpose: `rules`/`setRules`/`log`/`clearLog` answer
 * "what happened to a request under `crust-net`", this answers "does this machine have a path to the
 * network". Sharing the plugin name is the only thing they have in common, so they share no state.
 *
 * A listener that cannot be installed is a `NotImplemented` naming the platform call, never a
 * subscription that could never fire.
 */

import { notImplemented, type NotImplemented, type PluginContext } from "./define.ts";

/** What a platform says about the machine's path to the network. */
export interface NetworkStatus {
	/** True when the OS reports a usable path; a captive portal still counts as online. */
	online: boolean;
	/** The kinds of interface carrying a path, e.g. `wifi`, `wired`, `cellular`, `other`. */
	interfaceKinds: string[];
}

/** The native half of the two connectivity commands; `platform/darwin/network-status.ts` builds one. */
export interface NetworkStatusAdapter {
	readonly requires: string;
	status(): NetworkStatus;
	/**
	 * Register a native path observer; every report calls `listener` with the newest status.
	 * Returns false when the OS refused to install one.
	 */
	onChange(listener: (status: NetworkStatus) => void): boolean;
}

/** The event a page listens for; one name, so the page and the plugin cannot drift. */
export const NETWORK_CHANGE_EVENT = "network:change";

/** The platform call each refusal names, so a caller knows what is missing, not just that it is. */
const REQUIRES: Record<string, string> = {
	darwin: "SCNetworkReachability in SystemConfiguration",
	win32: "INetworkListManager in NetworkListManager",
	linux: "GNetworkMonitor in GIO (libgio-2.0.so.0, loaded through libgtk-3)",
};

export function platformRequires(platform: string = process.platform): string {
	return REQUIRES[platform] ?? "an OS network status API";
}

export interface NetworkStatusResult extends NetworkStatus {
	ok: true;
}

export interface NetworkChangeResult {
	ok: true;
	event: string;
}

/** The status answer, or the refusal naming the platform call. */
export function readStatus(
	adapter: NetworkStatusAdapter | undefined,
	platform?: string,
): NetworkStatusResult | NotImplemented {
	if (adapter === undefined) {
		const requires = platformRequires(platform);
		return notImplemented(
			`network.status needs ${requires}, which this platform does not provide.`,
			requires,
		);
	}
	return { ok: true, ...adapter.status() };
}

/**
 * Install the observer once and emit on every report. A second call replaces the listener set, so a
 * page that re-registers does not stack duplicate `network:change` events.
 */
export function subscribeStatus(
	adapter: NetworkStatusAdapter | undefined,
	ctx: PluginContext,
	platform?: string,
): NetworkChangeResult | NotImplemented {
	if (adapter === undefined) {
		const requires = platformRequires(platform);
		return notImplemented(
			`network.onChange needs ${requires}; no listener was installed, because one that can ` +
				"never fire is worse than a refusal.",
			requires,
		);
	}
	const installed = adapter.onChange((status) => {
		try {
			ctx.emit(NETWORK_CHANGE_EVENT, status);
		} catch {
			// A page handler that throws must not unwind into the native path callback.
		}
	});
	if (!installed) {
		return notImplemented(
			`network.onChange: ${adapter.requires} refused to install an observer.`,
			adapter.requires,
		);
	}
	return { ok: true, event: NETWORK_CHANGE_EVENT };
}
