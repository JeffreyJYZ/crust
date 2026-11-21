/**
 * The macOS half of `crust:network`: the adapter over the runtime `WKURLSchemeHandler` the C unit
 * builds (`network-ffi.ts` compiles it, `shim/110_network.c` + `shim/113_network_serve.c` hold it).
 * **The seam.** The handler's two IMPs are C and are installed by `network-registration.ts` on the
 * one `WKWebViewConfiguration` the app builds every window from. Because that module registers the
 * scheme at configuration creation — before any webview copies it — this adapter's lazy `install`
 * only hands over the real decision callback; it never tries to register a second handler, which
 * WebKit answers by raising a SIGABRT with no JavaScript error.
 */

import type { NetworkAdapter, NetworkInstall } from "@/plugins/network";
import { NETWORK_SCHEME } from "@/plugins/network-types";
import { installNetwork, URL_CHUNK as REGISTRATION_URL_CHUNK } from "./network-registration.ts";
import { networkSource, networkUnit, type NetworkUnit } from "./network-ffi.ts";

export { networkSource, networkUnit, type NetworkUnit } from "./network-ffi.ts";
/** Kept at this import path: the URL-bound tests and the probe read it from here. */
export const URL_CHUNK = REGISTRATION_URL_CHUNK;

export interface DarwinNetworkOptions {
	/**
	 * The `WKWebViewConfiguration` a window is built from, before the webview exists. Absent means
	 * nothing can be intercepted, and `install` says so instead of sending into WebKit.
	 */
	configuration?: () => number | undefined;
}

export function darwinNetworkAdapter(options: DarwinNetworkOptions = {}): NetworkAdapter {
	return {
		install(scheme, decide): NetworkInstall {
			const configuration = options.configuration?.();
			if (!configuration) {
				return {
					ok: false,
					reason: "network.install needs the WKWebViewConfiguration a window is built from: pass { configuration } to darwinNetworkAdapter, and build the webview with -initWithFrame:configuration:.",
				};
			}
			return installNetwork(configuration, scheme ?? NETWORK_SCHEME, decide);
		},
	};
}

/** How many bytes this process has delivered through the scheme, and how many tasks answered. */
export function networkServed(): { bytes: number; tasks: number } {
	const symbols = networkUnit().symbols;
	return { bytes: Number(symbols.net_served() ?? 0), tasks: Number(symbols.net_tasks() ?? 0) };
}
