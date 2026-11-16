// --- one named helper per vtable slot crust needs -------------------------
// TypeScript calls these and never computes a slot index. The indices are WebView2.h's
// declaration order; every one is UNVERIFIED on Windows, because this layer was written on macOS.

typedef struct {
	long left, top, right, bottom;
} shim_rect;

// ICoreWebView2Controller slot 6. Bounds are by value, so the rect is built on the C stack.
int wv2_put_bounds(void *ctrl, double w, double h) {
	shim_rect r;
	void **vt;
	if (!ctrl) return 0;
	r.left = 0;
	r.top = 0;
	r.right = (long)w;
	r.bottom = (long)h;
	vt = *(void ***)ctrl;
	((shim_i64 (*)(void *, shim_rect))vt[6])(ctrl, r);
	return 1;
}

// ICoreWebView2Controller slot 24.
void wv2_controller_close(void *ctrl) {
	void **vt;
	if (!ctrl) return;
	vt = *(void ***)ctrl;
	((shim_i64 (*)(void *))vt[24])(ctrl);
}

// ICoreWebView2 slot 37. This is the only navigation crust does on Windows: the URL the window was
// created with, which is the same value darwin hands to `-[WKWebView loadRequest:]`. There is no
// page-serving scheme here, because darwin has none either and `crust://` is the deep-link scheme.
int wv2_navigate(void *web, const shim_wchar *url) {
	void **vt;
	if (!web || !url) return 0;
	vt = *(void ***)web;
	return (int)(((shim_i64 (*)(void *, const shim_wchar *))vt[37])(web, url) >= 0);
}
