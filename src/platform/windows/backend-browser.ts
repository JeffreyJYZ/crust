/**
 * The browser surface's WebView2 calls, split out of `backend-webview.ts` at the line cap and on the
 * seam that file already uses: one namespace's calls, one interface, composed into `WindowsShim`.
 * A surface is a child HWND with a controller of its own, so these take a handle once the surface
 * exists and an HWND only while it is being created.
 */
export interface WindowsBrowserShim {
	/**
	 * The browser surface (`shim/57_browser.c`): a child window of the app's own class, positioned
	 * inside it, holding one controller of its own. `shim_child_new` copies no class name — the
	 * registered one is kept by `20_class.c`, because `CreateWindowExW` resolves a class by name.
	 */
	shim_child_new(parent: number, x: number, y: number, width: number, height: number): number;
	/** Geometry only, through the same WM_SIZE handler that resizes the app window's controller. */
	shim_child_move(child: number, x: number, y: number, width: number, height: number): number;
	/** `ICoreWebView2::get_Source` as UTF-8: the byte length written, 0 before a document commits. */
	shim_webview_url_text(handle: number, dst: Uint8Array, cap: number): number;
	/** `get_DocumentTitle` as UTF-8, the same shape. */
	shim_webview_title_text(handle: number, dst: Uint8Array, cap: number): number;
	shim_webview_can_go_back(handle: number): number;
	shim_webview_can_go_forward(handle: number): number;
	/** The flag the navigation events write: WebView2 has no synchronous `IsLoading`. */
	shim_webview_loading(handle: number): number;
	/**
	 * The whole browser-surface create: the WebView2 composite, both policy handlers, then the first
	 * load — in that order, because a handler installed after a fast completion leaves `loading` true.
	 * Answers the handle (>= 1), or -1 with the surface torn down. 0 is the app's own webview.
	 */
	shim_browser_surface_new(child: number, url: Uint8Array, userData: Uint8Array): number;
	/** Subscribe one surface to NavigationStarting/NavigationCompleted: 1 registered, 0 refused. */
	shim_webview_watch(handle: number): number;
	/** Refuse every `target=_blank` this surface asks for, reporting its URL instead. */
	shim_webview_refuse_popups(handle: number): number;
	/** One sink for refused windows (kind 0) and navigation decisions (kind 1); URLs read back below. */
	shim_browser_set_sink(sink: number): void;
	shim_browser_popups(): number;
	shim_browser_popup_url(dst: Uint8Array, cap: number): number;
	/** The target URI of the NavigationStarting event the sink is deciding on. */
	shim_browser_nav_url(dst: Uint8Array, cap: number): number;
}
