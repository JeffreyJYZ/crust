/**
 * `crust:network` as the runtime registers it: the interceptor over `WKURLSchemeHandler` **and** the
 * connectivity pair, in one plugin instance. Split out of `runtime-plugins.ts` because that file is at
 * the 200-line cap and this is one responsibility — which two adapters the plugin is built from.
 *
 * The two halves stay independent objects. Interception needs the `WKWebViewConfiguration` a window is
 * built from, and connectivity needs `SystemConfiguration`; an app that never supplies a configuration
 * still gets a working `status`/`onChange`, and one on a platform without reachability still gets the
 * interceptor.
 */

import type { PluginDefinition } from "@/plugins/define";
import { createNetworkPlugin } from "@/plugins/network";
import type { NetworkCommands } from "@/plugins/network-types";
import { darwinNetworkAdapter, type DarwinNetworkOptions } from "@/platform/darwin/network";
import { darwinNetworkStatusAdapter } from "@/platform/darwin/network-status";
import { webviewConfiguration } from "@/platform/darwin/webview-configuration";

/** The plugin the macOS runtime registers, with both adapters wired. */
export function darwinNetworkPlugin(
	options: DarwinNetworkOptions = {},
): PluginDefinition<"network", NetworkCommands> {
	return createNetworkPlugin(
		darwinNetworkAdapter({ configuration: webviewConfiguration, ...options }),
		{},
		darwinNetworkStatusAdapter(),
	);
}
