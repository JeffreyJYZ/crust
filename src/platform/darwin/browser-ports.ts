/**
 * The platform calls the browser adapter makes, injectable so a unit test never compiles C or sends
 * AppKit a message. The real set is built on first use — `cc()` and the navigation unit both compile
 * lazily, so merely importing the plugin costs nothing.
 */
import type { BrowserBounds, BrowserState } from "@/plugins/browser";
import { browserOwner, browserWindowOpen, type BrowserOwner } from "./browser-platform";
import { type BrowserNative, darwinBrowserNative } from "./browser-unit";
import { shim } from "./index";
import { navigationUnit, webviewText } from "./navigation-unit";
import { cstr, ptrValue, S } from "./objc";
import { darwinOpenerAdapter } from "./opener";
import { takeSnapshot } from "./snapshot";

export interface BrowserPorts {
	native: BrowserNative;
	owner(label?: string): BrowserOwner | undefined;
	windowOpen(label: string): boolean;
	contentView(win: number): number;
	newWebview(): number;
	/** Put the webview inside the host view; the one AppKit send the adapter makes itself. */
	addWebview(host: number, web: number): void;
	removeWebview(web: number): void;
	load(web: number, url: string): number;
	navInstall(web: number): number;
	navUninstall(web: number): void;
	navState(web: number): BrowserState;
	opener(url: string): { status: number; reason: string };
	/** One render of the surface's own webview; `takeSnapshot` on the real one. */
	snapshot(web: number): Promise<{ width: number; height: number; scale: number; png: string }>;
}

export function realPorts(): BrowserPorts {
	const native = darwinBrowserNative();
	const opener = darwinOpenerAdapter();
	return {
		native,
		owner: (label) => browserOwner(label),
		windowOpen: (label) => browserWindowOpen(label),
		contentView: (win) => ptrValue(S.p0(win, "contentView"), "-[NSWindow contentView]"),
		newWebview() {
			// A fresh configuration per surface: none of the app's user scripts or scheme handlers.
			const configuration = Number(shim().symbols.shim_webview_configuration() ?? 0);
			if (configuration === 0) return 0;
			return Number(shim().symbols.shim_webview_new(configuration, 0, 0) ?? 0);
		},
		addWebview: (host, web) => {
			S.v1(host, "addSubview:", web);
		},
		removeWebview: (web) => {
			S.v0(web, "removeFromSuperview");
		},
		load: (web, url) => Number(shim().symbols.shim_webview_load(web, cstr(url)) ?? 0),
		navInstall: (web) => Number(navigationUnit().symbols.crust_nav_install(web) ?? 1),
		navUninstall: (web) => {
			navigationUnit().symbols.crust_nav_uninstall(web);
		},
		navState(web) {
			const nav = navigationUnit().symbols;
			return {
				url: webviewText(nav.crust_nav_url, web),
				title: webviewText(nav.crust_nav_title, web),
				loading: Number(nav.crust_nav_loading(web) ?? 0) === 1,
				canGoBack: Number(nav.crust_nav_can_go_back(web) ?? 0) === 1,
				canGoForward: Number(nav.crust_nav_can_go_forward(web) ?? 0) === 1,
			};
		},
		opener: (url) => opener.openUrl(url),
		snapshot: (web) => takeSnapshot(web),
	};
}

/** Both frames one bounds change writes: the host, then the webview inside it. */
export function setFrames(
	native: BrowserNative,
	view: number,
	web: number,
	bounds: BrowserBounds,
): void {
	native.shim_browser_view_set_frame(view, bounds.x, bounds.y, bounds.width, bounds.height);
	native.shim_browser_view_set_frame(web, 0, 0, bounds.width, bounds.height);
}
