// --- the browser surface: a child window over the app's page ---------------
// `57_browser.c` compiles after `50_clipboard.c`, so `shim_utf8` is already defined when this part
// uses it — the order `shim-source.ts` pins is load-bearing, not layout.
// A second WebView2 controller needs a window of its own (`CreateCoreWebView2Controller` takes an
// HWND), so an overlay is a child of the app's window at the rectangle the caller reserved. The
// surface table in `41_surfaces.c` already keys every call by handle; this part adds only what a
// child needs, plus the reads `browser.state` answers with.
//
// A move is `SetWindowPos` on the child, not `put_Bounds` on the controller: `20_class.c`'s WM_SIZE
// handler resizes whichever controller names that HWND, the same call that keeps the app's own
// webview filling its window. The rectangle therefore has one owner and both objects follow it.

// Declared in `58_browser_events.c`, which compiles after this part: the create below installs both
// policies before the first navigation, so the order of the two files is load-bearing.
int shim_webview_watch(int handle);
int shim_webview_refuse_popups(int handle);

// WS_CHILD | WS_VISIBLE. A child is positioned by its parent and never becomes active, so a surface
// costs the human no focus the moment it opens.
#define SHIM_WS_CHILD 0x40000000u
#define SHIM_WS_VISIBLE 0x10000000u

// The child that holds one surface, of the app's own window class so WM_SIZE and WM_DESTROY are the
// handlers `20_class.c` already implements. 0 when Windows refused the window.
shim_h shim_child_new(shim_h parent, int x, int y, int w, int h) {
	shim_wchar name[256];
	shim_h child;
	if (!parent || w <= 0 || h <= 0) return 0;
	if (!shim_win32_load()) return 0;
	if (shim_class_name(name, 256) <= 0) return 0;
	child = CreateWindowExW(0u, name, name, SHIM_WS_CHILD | SHIM_WS_VISIBLE, x, y, w, h, parent, 0,
	                        GetModuleHandleW(0), 0);
	if (!child) return 0;
	ShowWindow(child, SHIM_SW_SHOW);
	return child;
}

// The whole browser-surface create: the WebView2 composite, both policy handlers, then the first load.
// The order is the point — a `NavigationCompleted` that fires before its handler exists leaves
// `state.loading` true for the life of the surface, and a new window requested before
// `NewWindowRequested` is handled becomes a window WebView2 owns. A refusal tears the surface down
// rather than leaving a half-policed one.
int shim_browser_surface_new(shim_h child, const char *url, const char *userData) {
	int handle = shim_webview_create(child, userData);
	if (handle < 0) return 0;
	if (!shim_webview_watch(handle) || !shim_webview_refuse_popups(handle)) {
		shim_webview_close(child);
		return 0;
	}
	if (!shim_webview_navigate(handle, url)) {
		shim_webview_close(child);
		return 0;
	}
	return handle;
}

// The rectangle a surface occupies, in the parent's client points. 1 on success; WM_SIZE does the
// controller resize, so this is the only geometry call the browser adapter needs.
int shim_child_move(shim_h child, int x, int y, int w, int h) {
	if (!child || w <= 0 || h <= 0) return 0;
	return SetWindowPos(child, 0, x, y, w, h, SHIM_SWP_GEOMETRY) ? 1 : 0;
}

// `48_dialog.c` declares and binds ole32's allocator for the PIDL it releases; this part compiles after
// it, so the same static is in scope here. A launch that never opened a panel has not resolved it yet,
// and a string this layer owns must not leak one per state read, so the address is taken directly —
// not through `SHIM_BIND`, which the import test counts once per declaration.
static void shim_browser_free(shim_wchar *text) {
	if (!text) return;
	if (!CoTaskMemFree)
		CoTaskMemFree = (void (*)(void *))GetProcAddress(g_ole32, "CoTaskMemFree");
	if (CoTaskMemFree) CoTaskMemFree((void *)text);
}

// One wide string a COM getter answered, as UTF-8 in a caller buffer, then released with COM's own
// allocator. Replies the copied byte length; 0 is "no value", which is a page that has not committed
// a document yet rather than an error.
static int shim_com_text(shim_wchar *text, char *dst, int cap) {
	int length = 0;
	int copied;
	if (dst && cap > 0) dst[0] = 0;
	if (!text) return 0;
	while (text[length]) length++;
	copied = shim_utf8(text, length, dst, cap);
	shim_browser_free(text);
	return copied > 0 ? copied : 0;
}

// `ICoreWebView2::get_Source` (slot 4) and `get_DocumentTitle` (slot 48) share one shape: a getter
// answering a wide string the caller owns. `which` 0 is the URL, 1 the title, so a wrong slot is one
// call site and one named constant rather than two copies.
static int shim_webview_read(int handle, int which, char *dst, int cap) {
	void *web = shim_surface_web(handle);
	void **vt;
	shim_wchar *text = 0;
	int slot = which == 0 ? SHIM_SLOT_WEBVIEW_GET_SOURCE : SHIM_SLOT_WEBVIEW_GET_TITLE;
	if (dst && cap > 0) dst[0] = 0;
	if (!web) return 0;
	vt = shim_object_vtbl(web);
	if (!vt || !shim_slot_ok(vt, slot)) return 0;
	if (((int (*)(void *, shim_wchar **))vt[slot])(web, &text) < 0) return 0;
	return shim_com_text(text, dst, cap);
}

int shim_webview_url_text(int handle, char *dst, int cap) {
	return shim_webview_read(handle, 0, dst, cap);
}

int shim_webview_title_text(int handle, char *dst, int cap) {
	return shim_webview_read(handle, 1, dst, cap);
}

// One BOOL getter on the ICoreWebView2: 1 true, 0 false, and 0 for a refused call too — a flag this
// layer cannot read is not a flag to claim.
static int shim_webview_flag(int handle, int slot) {
	void *web = shim_surface_web(handle);
	void **vt;
	int value = 0;
	if (!web) return 0;
	vt = shim_object_vtbl(web);
	if (!vt || !shim_slot_ok(vt, slot)) return 0;
	return ((int (*)(void *, int *))vt[slot])(web, &value) >= 0 && value ? 1 : 0;
}

int shim_webview_can_go_back(int handle) {
	return shim_webview_flag(handle, SHIM_SLOT_WEBVIEW_CAN_GO_BACK);
}

int shim_webview_can_go_forward(int handle) {
	return shim_webview_flag(handle, SHIM_SLOT_WEBVIEW_CAN_GO_FORWARD);
}

// The flag `45_browser_events.c`'s two navigation handlers write, and `Navigate` sets.
int shim_webview_loading(int handle) { return shim_surface_loading(handle); }
