// --- WebKitGTK webview -----------------------------------------------------
// The view alone. It is created against the default context and navigates to the
// URL the window was created with — the same absolute bridge URL darwin hands to
// -loadRequest: — so no URI scheme is registered anywhere in this layer.

static WebKitWebView *(*shim_view_new)(void);
static void (*shim_view_load)(WebKitWebView *, const char *);

int shim_webkit_resolve(void) {
	void *h = shim_webkit_handle();
	return shim_sym(h, "webkit_web_view_new", (void **)&shim_view_new) &&
	       shim_sym(h, "webkit_web_view_load_uri", (void **)&shim_view_load);
}

WebKitWebView *shim_webview_new(void) {
	if (!shim_view_new) return 0;
	return shim_view_new();
}

int shim_webview_load(void *web, const char *url) {
	if (!web || !url || !shim_view_load) return 0;
	shim_view_load((WebKitWebView *)web, url);
	return 1;
}
