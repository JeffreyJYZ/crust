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
static int g_navigate_hr;
static int g_bounds_hr;
static int g_visible_hr;

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

// The HRESULT of each step of the attach: `which` 0 is get_CoreWebView2, 1 is put_Bounds, 2 is
// put_IsVisible. A refused slot and a slot that returned an error are different defects and only these
// numbers tell them apart.
void *shim_webview_handle(void) { return g_web; }

// The webview object's vtable and one entry of it, so a bad ICoreWebView2 is a printed number before
// `Navigate` is attempted rather than a jump.
void *shim_webview_vtbl(void) {
	return (void *)shim_object_vtbl(g_web);
}

void *shim_webview_slot(int index) {
	void **vt = shim_object_vtbl(g_web);
	if (!vt || index < 0 || index >= 32) return 0;
	return vt[index];
}

shim_i64 shim_attach_hresult(int which) {
	if (which == 0) return (shim_i64)g_webview_hr;
	if (which == 1) return (shim_i64)g_bounds_hr;
	return (shim_i64)g_visible_hr;
}

// `get_CoreWebView2`, the controller's visibility, and the bookkeeping that makes the hwnd findable
// afterwards. Its own step, because a jump here is the object being wrong rather than the index.
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
	// `get_IsVisible` starts FALSE and a controller that is never made visible renders nothing, so this is
	// on the *product* path — every sample calls it between creating the controller and `put_Bounds`. Its
	// HRESULT is recorded rather than swallowed: a refusal here is a finding, not a silent no-op.
	g_visible_hr = wv2_put_visible(ctrl, 1);
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
//
// **The wide buffer is static, not a stack array, and must stay that way — for a reason measured, not
// assumed.** `shim_wchar target[2048]` is 4096 bytes of local, and with TinyCC's 32-byte scratch that
// is a 4128-byte frame. At 4096 TinyCC stops emitting the inline `push rbp; mov rbp,rsp; sub rsp,imm32`
// prologue and emits `call __chkstk` instead; nothing in this unit's link set defines `__chkstk`, so
// the call lands in a relocation filled with -1 — the `0xFFFFFFFFFFFFFFFF` that every failing run
// reported. The function died at its own first instruction, and the shared `.pdata` record made the
// crash report name `EmbeddedBrowserWebView.dll` instead. Windows ARM64 needs the same helper at the
// same 4096-byte threshold (`arm64_sub_sp` on PE), so the rule is not x64-only. `frame.test.ts` fails
// the gate if any local array in this unit reaches 4096 bytes, so this cannot come back by accident.
static shim_wchar g_url[2048];
static shim_wchar g_html[512];

int shim_webview_navigate(const char *url) {
	if (!g_web) return 0;
	if (shim_utf16(url, g_url, 2048) < 0) return 0;
	g_navigate_hr = wv2_navigate(g_web, g_url);
	return g_navigate_hr >= 0;
}

// `NavigateToString` with a fixed document, from a static buffer: the same string path with the URL
// parse removed. S_OK here and a fault in `Navigate` makes it a precise report about `Navigate`; a fault
// here too means every string-input method on this webview faults.
int shim_webview_navigate_string(void) {
	if (!g_web) return 0;
	if (shim_utf16("<html><body>crust</body></html>", g_html, 512) < 0) return 0;
	return wv2_navigate_to_string(g_web, g_html) >= 0;
}

int shim_navigate_hresult(void) { return g_navigate_hr; }

// ICoreWebView2 slot 4 (`get_Source`): S_OK proves the webview object is callable at all, which is what
// separates "the object is unusable" from "Navigate is the fault". The BSTR it answers is leaked on
// purpose — a probe never frees it, and only the HRESULT is read.
int shim_webview_source(void) { return wv2_get_source(g_web); }

// ICoreWebView2Controller slot 4 (`put_IsVisible(TRUE)`): what every sample calls after creating the
// controller and before `put_Bounds`, and what this layer never has.
int shim_controller_visible(void) { return wv2_put_visible(shim_controller_handle(), 1); }

// The whole path in one call, which is what the platform uses: environment, controller, attach,
// navigate. Every step is exported on its own above, so a probe can print between them; this
// composite exists so `window-open.ts` keeps one call and one failure.
// A pump before the first navigation, because this thread has never run a message loop: WebView2's own
// state is established by message traffic, and the canonical sample navigates from inside a running
// `GetMessage` loop rather than immediately after creating the controller.
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
	shim_pump();
	return shim_webview_navigate(url);
}

void shim_webview_close(shim_h hwnd) {
	int i = find_window(hwnd);
	if (i < 0) return;
	wv2_controller_close(g_ctrl[i]);
	// Give the slot back. g_windows is both the count and the index bind appends at, so a
	// failed create that already bound a controller would otherwise burn a permanent slot;
	// after eight retries bind refuses every create in the process.
	for (; i < g_windows - 1; i++) {
		g_hwnd[i] = g_hwnd[i + 1];
		g_ctrl[i] = g_ctrl[i + 1];
	}
	g_windows--;
	g_hwnd[g_windows] = 0;
	g_ctrl[g_windows] = 0;
}
