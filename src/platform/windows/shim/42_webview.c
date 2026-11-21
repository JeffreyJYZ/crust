// --- the WebView2 surface: environment, controller, attach -----------------
// The window procedure's size handler finds the controller from the hwnd alone, so this half keeps
// the hwnd-keyed entry points and resolves them to a handle in `41_surfaces.c`. The calls a probe and
// the page make — navigate, source, vtbl, the recorded HRESULTs — take that handle and live in
// `43_webview_calls.c`.
//
// The attach is two steps, not one: `get_CoreWebView2` (controller slot 25) and `put_Bounds` (slot 6, a
// 16-byte struct by reference) are the last two calls that can jump instead of returning, and a fault
// has to name which. `shim_webview_attach` is both, for the composite.
//
// One environment per process and one controller per surface; the controller *request* is still one at
// a time (`32_env.c`'s `g_ctrl_hwnd`/`g_ctrl_handler`), which is why `shim_webview_new` creates a
// surface sequentially rather than in parallel.

// Defined in `43_webview_calls.c`, which compiles after this part: the composite navigates the surface
// it has just bound.
int shim_webview_navigate(int handle, const char *url);

// How many surfaces still exist. WM_DESTROY reads this after shim_webview_close, so the quit is posted
// only once the last tracked surface is gone; closing one of three must not end the app before the
// runtime's own window-all-closed watcher runs.
int shim_webview_live(void) { return shim_surface_live(); }

// The handle a window's surface sits at — 0 for the app's own window — or -1 once it closed.
int shim_webview_index(shim_h hwnd) { return shim_surface_index(hwnd); }

// `put_Bounds` on one surface's controller. The app window's webview covers the client area at 0,0; a
// child surface carries the rectangle its caller asked for, in the same window points.
int shim_webview_set_bounds(int handle, double x, double y, double w, double h) {
	void *ctrl = shim_surface_ctrl(handle);
	int hr;
	if (!ctrl) return 0;
	hr = wv2_put_bounds_at(ctrl, x, y, w, h);
	shim_surface_set_hr(handle, SHIM_SURFACE_BOUNDS, hr);
	if (hr >= 0) shim_surface_set_bounds(handle, x, y, w, h);
	return hr >= 0;
}

// The window procedure's resize: the client rect, for whichever surface names this hwnd.
int shim_webview_put_bounds(shim_h hwnd, double w, double h) {
	int handle = shim_surface_index(hwnd);
	if (handle < 0) return 0;
	return shim_webview_set_bounds(handle, 0, 0, w, h);
}

// `get_CoreWebView2`, the controller's visibility, and the bookkeeping that makes the surface findable
// afterwards. Its own step, because a jump here is the object being wrong rather than the index. The
// HRESULT is recorded whatever it says: a refused `get_CoreWebView2` is the number the failure text
// and the probe both read.
int shim_webview_bind(shim_h hwnd) {
	void *ctrl = shim_controller_handle();
	void *web = 0;
	int handle;
	int hr;
	if (!hwnd || !ctrl) return 0;
	handle = shim_surface_index(hwnd);
	if (handle < 0) {
		handle = shim_surface_reserve(hwnd);
		if (handle < 0) return 0;
	}
	if (!shim_surface_set_ctrl(handle, ctrl)) return 0;
	hr = wv2_controller_webview(ctrl, &web);
	shim_surface_set_hr(handle, SHIM_SURFACE_WEBVIEW, hr);
	if (hr < 0 || !web) return 0;
	shim_surface_set_web(handle, web);
	// `get_IsVisible` starts FALSE and a controller that is never made visible renders nothing, so this
	// is on the *product* path — every sample calls it between creating the controller and `put_Bounds`.
	// Its HRESULT is recorded rather than swallowed: a refusal here is a finding, not a silent no-op.
	shim_surface_set_hr(handle, SHIM_SURFACE_VISIBLE, wv2_put_visible(ctrl, 1));
	return 1;
}

// `put_Bounds` from the client rect. The controller starts at zero size; without this call the page
// renders nowhere and the window looks like a rendering failure rather than a sizing bug.
int shim_webview_size(shim_h hwnd) {
	int handle = shim_surface_index(hwnd);
	if (handle < 0) return 0;
	return shim_webview_set_bounds(handle, 0, 0, (double)shim_window_client_num(hwnd, 2),
	                               (double)shim_window_client_num(hwnd, 3));
}

int shim_webview_attach(shim_h hwnd) {
	if (!shim_webview_bind(hwnd)) return 0;
	return shim_webview_size(hwnd);
}

// The whole path in one call, which is what the platform uses: environment, controller, attach,
// navigate. Every step is exported on its own in `43_webview_calls.c`, so a probe can print between
// them; this composite exists so `window-open.ts` keeps one call and one failure.
// A pump before the first navigation, because this thread has never run a message loop: WebView2's own
// state is established by message traffic, and the canonical sample navigates from inside a running
// `GetMessage` loop rather than immediately after creating the controller.
int shim_webview_new(shim_h hwnd, const char *url, const char *userData) {
	int handle;
	if (!hwnd) return 0;
	if (shim_surface_live() >= SHIM_MAX_SURFACES) return 0;
	if (!shim_environment_handle()) {
		if (shim_env_begin(hwnd, userData) < 0) return 0;
		if (!shim_env_wait()) return 0;
		if (shim_env_callback() < 0 || !shim_environment_handle()) return 0;
	}
	if (shim_controller_begin(hwnd) < 0) return 0;
	if (!shim_controller_wait()) return 0;
	if (shim_controller_callback() < 0 || !shim_controller_handle()) return 0;
	if (!shim_webview_attach(hwnd)) return 0;
	handle = shim_surface_index(hwnd);
	shim_pump();
	return shim_webview_navigate(handle, url);
}

// Close one surface's controller and free its slot. A title-bar X, a failed create and `quit()` all
// arrive here: the slot is the scarce resource, and the eight-slot table is all a process gets.
void shim_webview_close(shim_h hwnd) {
	int handle = shim_surface_index(hwnd);
	void *ctrl;
	if (handle < 0) return;
	ctrl = shim_surface_ctrl(handle);
	if (ctrl) wv2_controller_close(ctrl);
	shim_surface_release(handle);
}
