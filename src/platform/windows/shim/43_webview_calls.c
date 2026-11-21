// --- the calls a handle addresses ------------------------------------------
// Split from `42_webview.c` when the handle table pushed that part past the line cap, and on the same
// seam: this file is every call whose subject is one *surface*, so the first argument is the handle and
// nothing here needs a window. `42_webview.c` owns the window-keyed half (bind, size, create, close).
//
// Every one of these answers a typed refusal for a handle that names no live surface — 0, or `E_FAIL`
// from the vtable helper — rather than reading entry 0 by accident. A second surface makes "the wrong
// webview answered" a real failure mode, and a handle is the only thing that keeps them apart.

// Navigate the webview at `handle`. `url` is the value the caller already resolved, and it is the same
// value darwin hands to `loadRequest:`.
//
// **The wide buffer is per surface and static, must stay static, and must not go back to one shared
// buffer — for a reason measured, not assumed.** A local `shim_wchar target[2048]` is 4096 bytes of
// frame, and with TinyCC's 32-byte scratch that is 4128: at 4096 TinyCC stops emitting the inline
// `push rbp; mov rbp,rsp; sub rsp,imm32` prologue and emits `call __chkstk`, which nothing in this
// unit's link set defines, so the call landed in a relocation filled with -1 — the
// `0xFFFFFFFFFFFFFFFF` every failing run reported. Windows ARM64 needs the same helper at the same
// threshold, so the rule is not x64-only, and `frame.test.ts` fails the gate on any local array here
// that reaches 4096 bytes. Shared between surfaces it was also a latent defect: WebView2 marshals a
// string to its browser process lazily, so the second surface's navigation would rewrite the bytes the
// first one was still about to read.
int shim_webview_navigate(int handle, const char *url) {
	void *web = shim_surface_web(handle);
	unsigned short *target = shim_surface_url(handle);
	int hr;
	if (!web || !target) return 0;
	if (shim_utf16(url, target, SHIM_SURFACE_URL_MAX) < 0) return 0;
	hr = wv2_navigate(web, target);
	shim_surface_set_hr(handle, SHIM_SURFACE_NAVIGATE, hr);
	return hr >= 0;
}

// `NavigateToString` with a fixed document, from a static buffer: the same string path with the URL
// parse removed. S_OK here and a fault in `Navigate` makes it a precise report about `Navigate`; a fault
// here too means every string-input method on that webview faults. One buffer serves every surface
// because the document is a constant — unlike the URL, nothing can overwrite it with another value.
static shim_wchar g_html[512];

int shim_webview_navigate_string(int handle) {
	void *web = shim_surface_web(handle);
	if (!web) return 0;
	if (shim_utf16("<html><body>crust</body></html>", g_html, 512) < 0) return 0;
	return wv2_navigate_to_string(web, g_html) >= 0;
}

/** The HRESULT the last `Navigate` on that surface returned, for the print after the call. */
int shim_navigate_hresult(int handle) {
	return shim_surface_hr(handle, SHIM_SURFACE_NAVIGATE);
}

// ICoreWebView2 slot 4 (`get_Source`): S_OK proves the webview object is callable at all, which is what
// separates "the object is unusable" from "Navigate is the fault". The BSTR it answers is leaked on
// purpose — a probe never frees it, and only the HRESULT is read.
int shim_webview_source(int handle) { return wv2_get_source(shim_surface_web(handle)); }

// ICoreWebView2Controller slot 4 (`put_IsVisible(TRUE)`): what every sample calls after creating the
// controller and before `put_Bounds`, and what this layer never had. Addressed by handle so a probe can
// make a *child* surface visible without touching the app window's controller.
int shim_controller_visible(int handle) {
	return wv2_put_visible(shim_surface_ctrl(handle), 1);
}

/** The ICoreWebView2 at that handle; 0 when the handle names no live surface. */
void *shim_webview_handle(int handle) { return shim_surface_web(handle); }

// The webview object's vtable and one entry of it, so a bad ICoreWebView2 is a printed number before
// `Navigate` is attempted rather than a jump.
void *shim_webview_vtbl(int handle) {
	return (void *)shim_object_vtbl(shim_surface_web(handle));
}

void *shim_webview_slot(int handle, int index) {
	void **vt = shim_object_vtbl(shim_surface_web(handle));
	if (!vt || index < 0 || index >= 32) return 0;
	return vt[index];
}

// The HRESULT of each step of the attach: `which` 0 is get_CoreWebView2, 1 is put_Bounds, 2 is
// put_IsVisible. A refused slot and a slot that returned an error are different defects and only these
// numbers tell them apart.
shim_i64 shim_attach_hresult(int handle, int which) {
	return (shim_i64)shim_surface_hr(handle, which);
}

/** The rectangle this layer last applied at that handle: 0 x, 1 y, 2 width, 3 height. */
double shim_webview_bound(int handle, int which) {
	return shim_surface_bound(handle, which);
}
