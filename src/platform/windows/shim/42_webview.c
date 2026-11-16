// --- the hwnd -> controller table -----------------------------------------
// TypeScript passes a window handle and never a COM pointer, so the pointers live here and the
// window procedure's size handler finds the controller from the hwnd alone.
//
// The attach is two steps, not one: `get_CoreWebView2` (controller slot 25) and `put_Bounds` (slot 6, a
// 16-byte struct by reference) are the last two calls that can jump instead of returning, and a fault
// has to name which. `shim_webview_attach` is both, for the composite.

#define SHIM_MAX_WINDOWS 8
static shim_h g_hwnd[SHIM_MAX_WINDOWS];
static void *g_ctrl[SHIM_MAX_WINDOWS];
static void *g_web;
static int g_windows;
static int g_webview_hr;
static int g_bounds_hr;

static int find_window(shim_h hwnd) {
	int i;
	for (i = 0; i < g_windows; i++)
		if (g_hwnd[i] == hwnd) return i;
	return -1;
}

int shim_webview_put_bounds(shim_h hwnd, double w, double h) {
	int i = find_window(hwnd);
	if (i < 0) return 0;
	return wv2_put_bounds(g_ctrl[i], w, h);
}

// The ICoreWebView2 the last bind produced, and the HRESULT of each half: `which` 0 is
// get_CoreWebView2, 1 is put_Bounds. A refused slot and a slot that returned an error are different
// defects and only these two numbers tell them apart.
void *shim_webview_handle(void) { return g_web; }

// The webview object's vtable and one entry of it, so a bad ICoreWebView2 is a printed number before
// `Navigate` is attempted rather than a jump.
void *shim_webview_vtbl(void) {
	if (!g_web) return 0;
	return *(void **)g_web;
}

void *shim_webview_slot(int index) {
	void **vt;
	if (!g_web || index < 0 || index >= 32) return 0;
	vt = *(void ***)g_web;
	return vt[index];
}

shim_i64 shim_attach_hresult(int which) { return (shim_i64)(which == 0 ? g_webview_hr : g_bounds_hr); }

// `get_CoreWebView2`, plus the bookkeeping that makes the hwnd findable afterwards. Its own step,
// because a jump here is the object being wrong rather than the index.
int shim_webview_bind(shim_h hwnd) {
	void *ctrl = shim_controller_handle();
	void *web = 0;
	int i;
	if (!hwnd || !ctrl) return 0;
	if (g_windows >= SHIM_MAX_WINDOWS) return 0;
	g_webview_hr = wv2_controller_webview(ctrl, &web);
	if (g_webview_hr < 0 || !web) return 0;
	i = g_windows++;
	g_hwnd[i] = hwnd;
	g_ctrl[i] = ctrl;
	g_web = web;
	return 1;
}

// `put_Bounds` from the client rect. The controller starts at zero size; without this call the page
// renders nowhere and the window looks like a rendering failure rather than a sizing bug.
int shim_webview_size(shim_h hwnd) {
	void *ctrl = shim_controller_handle();
	if (!ctrl) return 0;
	g_bounds_hr = wv2_put_bounds(ctrl, (double)shim_window_client_num(hwnd, 2),
	                            (double)shim_window_client_num(hwnd, 3));
	return g_bounds_hr >= 0;
}

int shim_webview_attach(shim_h hwnd) {
	if (!shim_webview_bind(hwnd)) return 0;
	return shim_webview_size(hwnd);
}

// Navigate the webview `shim_webview_bind` recorded. `url` is the value the caller already resolved,
// and it is the same value darwin hands to `loadRequest:`.
int shim_webview_navigate(const char *url) {
	shim_wchar target[2048];
	if (!g_web) return 0;
	if (shim_utf16(url, target, 2048) < 0) return 0;
	return wv2_navigate(g_web, target);
}

// The whole path in one call, which is what the platform uses: environment, controller, attach,
// navigate. Every step is exported on its own above, so a probe can print between them; this
// composite exists so `window-open.ts` keeps one call and one failure.
int shim_webview_new(shim_h hwnd, const char *url, const char *userData) {
	if (!hwnd) return 0;
	if (g_windows >= SHIM_MAX_WINDOWS) return 0;
	if (!shim_environment_handle()) {
		if (shim_env_begin(hwnd, userData) < 0) return 0;
		if (!shim_env_wait()) return 0;
		if (shim_env_callback() < 0 || !shim_environment_handle()) return 0;
	}
	if (shim_controller_begin(hwnd) < 0) return 0;
	if (!shim_controller_wait()) return 0;
	if (shim_controller_callback() < 0 || !shim_controller_handle()) return 0;
	if (!shim_webview_attach(hwnd)) return 0;
	return shim_webview_navigate(url);
}

void shim_webview_close(shim_h hwnd) {
	int i = find_window(hwnd);
	if (i < 0) return;
	wv2_controller_close(g_ctrl[i]);
	g_ctrl[i] = 0;
	g_hwnd[i] = 0;
}
