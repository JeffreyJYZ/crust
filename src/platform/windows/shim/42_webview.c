// --- the hwnd -> controller table -----------------------------------------
// TypeScript passes a window handle and never a COM pointer, so the pointers live here and the
// window procedure's size handler finds the controller from the hwnd alone.

#define SHIM_MAX_WINDOWS 8
static shim_h g_hwnd[SHIM_MAX_WINDOWS];
static void *g_ctrl[SHIM_MAX_WINDOWS];
static void *g_web;
static int g_windows;

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

// The controller and the webview for the window just created. Its own step, because everything that
// can go wrong here — a wrong vtable slot, a controller that is not an ICoreWebView2Controller — is a
// jump rather than an error code, and one line of output has to name it.
// Returns 1 when the window is tracked and sized; 0 on any refusal.
int shim_webview_attach(shim_h hwnd) {
	void *ctrl = shim_controller_handle();
	void *web = 0;
	int i;
	int w;
	int h;
	if (!hwnd || !ctrl) return 0;
	if (g_windows >= SHIM_MAX_WINDOWS) return 0;
	if (wv2_controller_webview(ctrl, &web) < 0 || !web) return 0;

	i = g_windows++;
	g_hwnd[i] = hwnd;
	g_ctrl[i] = ctrl;
	g_web = web;
	// The controller starts at zero size; without a bounds call the page renders nowhere and the
	// window looks like a rendering failure rather than a sizing bug.
	w = shim_window_client_num(hwnd, 2);
	h = shim_window_client_num(hwnd, 3);
	wv2_put_bounds(ctrl, (double)w, (double)h);
	return 1;
}

// Navigate the webview `shim_webview_attach` recorded. `url` is the value the caller already resolved,
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
