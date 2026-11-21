/**
 * The browser surface's entry points, split out of `LinuxShim` at the line cap and on the same seam
 * `dialog-ffi.ts` uses: one namespace with its own entry points, every member optional because an
 * older WebKitGTK fails one command by name rather than refusing to launch. `shim-ffi.ts` composes
 * them into `LinuxShim`, which is still the only type a caller names.
 */
export interface LinuxBrowserShim {
	/**
	 * The browser surface's reads and its two policies, all keyed by the `WebKitWebView *` the
	 * commands carry. Each answers 0 / empty when the library is too old for that entry point, so an
	 * older WebKitGTK fails one command by name instead of refusing to launch.
	 */
	shim_webview_uri?(web: bigint): string | null;
	shim_webview_is_loading?(web: bigint): number;
	/** The loaded document's title, read from the view; null before a document commits. */
	shim_webview_title?(web: bigint): string | null;
	shim_webview_can_back?(web: bigint): number;
	shim_webview_can_forward?(web: bigint): number;
	/** Destroy one surface's widget, which removes it from the window's container too. */
	shim_webview_close?(web: bigint): number;
	/** Refuse every new window this view asks for, reporting its URL instead. */
	shim_browser_watch_popups?(web: bigint): number;
	/** Deny every permission request the view's page makes: capture, geolocation, clipboard. */
	shim_browser_deny_capture?(web: bigint): number;
	shim_browser_set_sink?(sink: number): void;
	shim_browser_popups?(): number;
	shim_browser_popup_url?(dst: Uint8Array, cap: number): number;
}
