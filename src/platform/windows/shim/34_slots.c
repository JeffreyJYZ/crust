// --- one named helper per vtable slot crust needs -------------------------
// TypeScript calls these and never computes a slot index. The indices are named in `10_prelude.c`
// beside the WebView2.h declaration order they were checked against, because a bare number here is
// what made `Navigate` call `GetBrowserProcessId` (2026-11-16).
//
// Every vtable call returns `int`: HRESULT is 32 bits, and a function that returns 32 bits leaves the
// top half of RAX undefined, so declaring `shim_i64` and sign-testing it reads garbage.

typedef struct {
	long left, top, right, bottom;
} shim_rect;

// ICoreWebView2Controller slot 6. The signature says `put_Bounds(RECT bounds)`. How that 16-byte
// struct crosses is the one real x64/arm64 split in this unit: Windows x64 passes composites larger
// than 8 bytes by pointer, so the pointer form is right there; Windows ARM64 follows AAPCS64, where
// stage B.3 copies to memory only composites *larger* than 16 bytes and rule C.10 loads a 16-byte
// composite into consecutive general-purpose registers. Passing &r on arm64 would make WebView2 read
// the pointer as rcMonitor's left/top and ignore right/bottom. TCC's arm64 backend implements C.10,
// so declaring the struct by value there matches the method WebView2 actually compiled.
// Returns the method's own HRESULT, so a refusal and a crash are distinguishable.
//
// `x`/`y` exist for a surface that is not the whole client area: the app's own webview is put at 0,0
// and a child surface carries the rectangle the caller asked for, so this is the one call that turns
// "a second webview" into "a second webview *somewhere*".
int wv2_put_bounds_at(void *ctrl, double x, double y, double w, double h) {
	shim_rect r;
	void **vt = shim_object_vtbl(ctrl);
	if (!vt) return -2147467259; /* E_FAIL: the object itself is unreadable */
	r.left = (long)x;
	r.top = (long)y;
	r.right = (long)(x + w);
	r.bottom = (long)(y + h);
	if (!shim_slot_ok(vt, SHIM_SLOT_CONTROLLER_PUT_BOUNDS)) return -2147467262;
#if defined(__aarch64__)
	return ((int (*)(void *, shim_rect))vt[SHIM_SLOT_CONTROLLER_PUT_BOUNDS])(ctrl, r);
#else
	return ((int (*)(void *, shim_rect *))vt[SHIM_SLOT_CONTROLLER_PUT_BOUNDS])(ctrl, &r);
#endif
}

// The whole-client-area form, which is what the window procedure resizes.
int wv2_put_bounds(void *ctrl, double w, double h) {
	return wv2_put_bounds_at(ctrl, 0, 0, w, h);
}

// ICoreWebView2Controller slot 24.
void wv2_controller_close(void *ctrl) {
	void **vt = shim_object_vtbl(ctrl);
	if (!vt) return;
	if (!shim_slot_ok(vt, SHIM_SLOT_CONTROLLER_CLOSE)) return;
	((int (*)(void *))vt[SHIM_SLOT_CONTROLLER_CLOSE])(ctrl);
}

// ICoreWebView2Controller slot 4, `put_IsVisible(TRUE)` — what every sample does after creating the
// controller and before `put_Bounds`, and what this layer never has. Its HRESULT is a finding on its own.
int wv2_put_visible(void *ctrl, int visible) {
	void **vt;
	if (!ctrl) return -2147467259; /* E_FAIL */
	vt = shim_object_vtbl(ctrl);
	if (!vt) return -2147467259;
	if (!shim_slot_ok(vt, SHIM_SLOT_CONTROLLER_PUT_VISIBLE)) return -2147467262;
	return ((int (*)(void *, int))vt[SHIM_SLOT_CONTROLLER_PUT_VISIBLE])(ctrl, visible);
}

// ICoreWebView2 slot 4, `get_Source`: a trivial getter that answers a BSTR. **The string is deliberately
// leaked** — the probe never frees it — and only the HRESULT matters: S_OK proves the object is callable,
// which turns a fault in `Navigate` into "the call", not "the object".
int wv2_get_source(void *web) {
	void **vt;
	void *bstr = 0;
	if (!web) return -2147467259; /* E_FAIL */
	vt = shim_object_vtbl(web);
	if (!vt) return -2147467259;
	if (!shim_slot_ok(vt, SHIM_SLOT_WEBVIEW_GET_SOURCE)) return -2147467262;
	return ((int (*)(void *, void **))vt[SHIM_SLOT_WEBVIEW_GET_SOURCE])(web, &bstr);
}

// ICoreWebView2 slot 5, `Navigate`. It was slot 37 — `GetBrowserProcessId`, whose second parameter
// is a `UINT *` — so navigation silently did nothing and a process id was written over the URL. This
// is the only navigation crust does on Windows: the URL the window was created with, the same value
// darwin hands to `-[WKWebView loadRequest:]`. There is no page-serving scheme here, because darwin
// has none either and `crust://` is the deep-link scheme.
// ICoreWebView2 slot 6, `NavigateToString`: the same string path as `Navigate` with the URL parse taken
// out. If this answers S_OK while `Navigate` faults, the defect is `Navigate` specifically; if both
// fault, every string-input method on the webview does.
int wv2_navigate_to_string(void *web, const shim_wchar *html) {
	void **vt;
	if (!html) return -2147467259; /* E_FAIL */
	vt = shim_object_vtbl(web);
	if (!vt) return -2147467259;
	if (!shim_slot_ok(vt, SHIM_SLOT_WEBVIEW_NAVIGATE_TO_STRING)) return -2147467262;
	return ((int (*)(void *, const shim_wchar *))vt[SHIM_SLOT_WEBVIEW_NAVIGATE_TO_STRING])(
	    web, html);
}

// Returns the method's own HRESULT so a refusal is distinguishable from success.
int wv2_navigate(void *web, const shim_wchar *url) {
	void **vt;
	if (!url) return -2147467259; /* E_FAIL */
	vt = shim_object_vtbl(web);
	if (!vt) return -2147467259;
	if (!shim_slot_ok(vt, SHIM_SLOT_WEBVIEW_NAVIGATE)) return -2147467262;
	return ((int (*)(void *, const shim_wchar *))vt[SHIM_SLOT_WEBVIEW_NAVIGATE])(web, url);
}
