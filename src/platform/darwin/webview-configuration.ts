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
import { shim } from "./index.ts";
import { ptrValue } from "./objc.ts";

let configuration = 0;

/** The app's `WKWebViewConfiguration`, created on first ask; 0 only when WebKit refused. */
export function webviewConfiguration(): number {
	if (configuration !== 0) return configuration;
	configuration = ptrValue(
		shim().symbols.shim_webview_configuration(),
		"[[WKWebViewConfiguration alloc] init]",
	);
	return configuration;
}
