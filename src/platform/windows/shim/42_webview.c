// --- the hwnd -> controller table -----------------------------------------
// TypeScript passes a window handle and never a COM pointer, so the pointers live here and the
// window procedure's size handler finds the controller from the hwnd alone.

#define SHIM_MAX_WINDOWS 8
static shim_h g_hwnd[SHIM_MAX_WINDOWS];
static void *g_ctrl[SHIM_MAX_WINDOWS];
static void *g_env;
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

// Environment once per process, controller and webview once per window. `url` is navigated to as
// given: the caller already resolved it, and it is the same value darwin hands to loadRequest:.
// Returns 1 when every step landed; the caller destroys the window on 0.
int shim_webview_new(shim_h hwnd, const char *url, const char *userData) {
	shim_wchar target[2048];
	void *ctrl;
	void *web = 0;
	int i;
	int w;
	int h;
	if (!hwnd) return 0;
	if (shim_utf16(url, target, 2048) < 0) return 0;
	if (g_windows >= SHIM_MAX_WINDOWS) return 0;
	if (!g_env) g_env = shim_environment(userData);
	if (!g_env) return 0;
	ctrl = shim_controller(g_env, hwnd);
	if (!ctrl) return 0;
	if (wv2_controller_webview(ctrl, &web) < 0 || !web) return 0;

	i = g_windows++;
	g_hwnd[i] = hwnd;
	g_ctrl[i] = ctrl;
	// The controller starts at zero size; without a bounds call the page renders nowhere and the
	// window looks like a rendering failure rather than a sizing bug.
	w = shim_window_client_num(hwnd, 2);
	h = shim_window_client_num(hwnd, 3);
	wv2_put_bounds(ctrl, (double)w, (double)h);
	return wv2_navigate(web, target);
}

void shim_webview_close(shim_h hwnd) {
	int i = find_window(hwnd);
	if (i < 0) return;
	wv2_controller_close(g_ctrl[i]);
	g_ctrl[i] = 0;
	g_hwnd[i] = 0;
}
