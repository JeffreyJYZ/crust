// --- a surface's policy: refused new windows, denied capture --------------
// A browser surface is an ordinary WebKitWebView placed in a window's container, so the two policies
// darwin installs in a `WKUIDelegate` are GTK signals here:
//   - `create` refuses every new view and reports its URL, so `target=_blank` and `window.open` never
//     become a second webview. The URL reaches JavaScript, and the plugin decides what a click means.
//   - `permission-request` answers FALSE, which denies microphone, camera, geolocation and clipboard
//     reads outright: a remote page inside the app must never be able to ask the process for them.
//
// The surface carries no bridge token at all — the plugin builds it from a fresh view, so
// `window.crust` does not exist inside it.

#define SHIM_BROWSER_POPUP_CAP 2048

// The one sink a refused new window is reported through; a GObject signal handler may not cross
// bun:ffi, so the URL is read back through `shim_browser_popup_url`.
static int (*shim_browser_sink)(int count, void *web);
static char shim_browser_popup[SHIM_BROWSER_POPUP_CAP];
static int shim_browser_count;

static void *(*shim_action_request)(void *action);
static const char *(*shim_request_uri)(void *request);

// Resolved from the WebKit handle the prelude opened, on first use: an older WebKitGTK that lacks
// `webkit_navigation_action_get_request` refuses the URL report and still refuses the new window.
static void shim_browser_resolve(void) {
	static int done;
	void *h;
	if (done) return;
	done = 1;
	h = shim_webkit_handle();
	shim_action_request =
	    (void *(*)(void *))shim_sym_or_null(h, "webkit_navigation_action_get_request");
	shim_request_uri = (const char *(*)(void *))shim_sym_or_null(h, "webkit_uri_request_get_uri");
}

// The action's target URI into `shim_browser_popup`; an action with no request leaves it empty.
static void shim_browser_record(void *action) {
	const char *uri = 0;
	shim_browser_popup[0] = 0;
	shim_browser_resolve();
	if (action && shim_action_request && shim_request_uri) {
		void *request = shim_action_request(action);
		if (request) uri = shim_request_uri(request);
	}
	if (uri) shim_copy_text(shim_browser_popup, SHIM_BROWSER_POPUP_CAP, uri);
}

// Returning NULL is the refusal: WebKit creates no second view, and the URL goes to JavaScript.
static void *shim_browser_created(void *web, void *action, void *data) {
	(void)data;
	shim_browser_record(action);
	shim_browser_count++;
	if (shim_browser_sink) shim_browser_sink(shim_browser_count, web);
	return 0;
}

// FALSE denies. WebKit's own `permission-request` contract is deny-on-unhandled, and this layer makes
// that explicit rather than relying on it.
static int shim_browser_denied(void *web, void *request, void *data) {
	(void)web;
	(void)request;
	(void)data;
	return 0;
}

/** Refuse new windows for one surface; 1 connected, 0 when the signal could not be. */
int shim_browser_watch_popups(void *web) {
	if (!web || !shim_view_connect) return 0;
	shim_browser_resolve();
	return shim_view_connect(web, "create", (void *)shim_browser_created, 0, 0, 0) ? 1 : 0;
}

/** Deny every permission request a surface's page makes. */
int shim_browser_deny_capture(void *web) {
	if (!web || !shim_view_connect) return 0;
	return shim_view_connect(web, "permission-request", (void *)shim_browser_denied, 0, 0, 0) ? 1 : 0;
}

void shim_browser_set_sink(void *sink) { shim_browser_sink = (int (*)(int, void *))sink; }

int shim_browser_popups(void) { return shim_browser_count; }

// The URL of the last refused new window, as UTF-8 into a caller buffer; the full length.
int shim_browser_popup_url(char *dst, int cap) {
	int length = 0;
	int take;
	if (!dst || cap <= 0) return 0;
	while (shim_browser_popup[length]) length++;
	take = length < cap - 1 ? length : cap - 1;
	for (int i = 0; i < take; i++) dst[i] = shim_browser_popup[i];
	dst[take] = 0;
	return length;
}
