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

// ICoreWebView2Controller slot 6. The signature says `put_Bounds(RECT bounds)`, and a 16-byte struct
// is passed **by reference** on x64 — so the parameter is declared as a pointer and the address is
// passed, which is the call the ABI already makes. Declaring it by value would leave the sequence to
// TinyCC's struct codegen, which nothing on this machine can test.
// Returns the method's own HRESULT, so a refusal and a crash are distinguishable.
int wv2_put_bounds(void *ctrl, double w, double h) {
	shim_rect r;
	void **vt = shim_object_vtbl(ctrl);
	if (!vt) return -2147467259; /* E_FAIL: the object itself is unreadable */
	r.left = 0;
	r.top = 0;
	r.right = (long)w;
	r.bottom = (long)h;
	if (!shim_slot_ok(vt, SHIM_SLOT_CONTROLLER_PUT_BOUNDS)) return -2147467262;
	return ((int (*)(void *, shim_rect *))vt[SHIM_SLOT_CONTROLLER_PUT_BOUNDS])(ctrl, &r);
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
// Returns the method's own HRESULT so a refusal is distinguishable from success.
int wv2_navigate(void *web, const shim_wchar *url) {
	void **vt;
	if (!url) return -2147467259; /* E_FAIL */
	vt = shim_object_vtbl(web);
	if (!vt) return -2147467259;
	if (!shim_slot_ok(vt, SHIM_SLOT_WEBVIEW_NAVIGATE)) return -2147467262;
	return ((int (*)(void *, const shim_wchar *))vt[SHIM_SLOT_WEBVIEW_NAVIGATE])(web, url);
}
