/**
 * The one `WKWebViewConfiguration` this process's windows are built from, and the reason there is
 * exactly one.
 *
 * A `WKURLSchemeHandler` can only be registered on a configuration, and WebKit copies that
 * configuration when a webview is created — so a handler registered afterwards never reaches a
 * webview that already exists (measured 2026-11-16: a page loaded after
 * `setURLSchemeHandler:forURLScheme:` on its own configuration still failed its fetch, while the
 * same call before the webview was created serves bytes). A single configuration for the process
 * is what lets a handler's owner register once, before the first window, and have every window
 * built afterwards carry it; two webviews from one registered configuration both build (measured).
 *
 * Nothing here names a scheme, and nothing here registers a handler: that is the caller's, so
 * `network.darwinNetworkAdapter({ configuration })` is the module that knows `crust-net`.
 */
import { NETWORK_SCHEME } from "@/plugins/network-types";
import { shim } from "./index.ts";
import { primeNetwork } from "./network-registration.ts";
import { ptrValue } from "./objc.ts";

let configuration = 0;

/** The app's `WKWebViewConfiguration`, created on first ask; 0 only when WebKit refused. */
export function webviewConfiguration(): number {
	if (configuration !== 0) return configuration;
	configuration = ptrValue(
		shim().symbols.shim_webview_configuration(),
		"[[WKWebViewConfiguration alloc] init]",
	);
	// The handler must be on this object before WebKit copies it into the first webview. The plugin
	// registers its real decision callback later; this prime only claims the scheme while it is safe.
	if (configuration !== 0) primeNetwork(configuration, NETWORK_SCHEME);
	return configuration;
}
