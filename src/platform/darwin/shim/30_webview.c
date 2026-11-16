// --- webview construction -------------------------------------------------
// A webview is built from a WKWebViewConfiguration, never from `[[WKWebView alloc] init]`.
// WebKit copies the configuration when the webview is created, so a `WKURLSchemeHandler`
// registered afterwards never reaches a webview that already exists — measured 2026-11-16: a
// page loaded after `setURLSchemeHandler:forURLScheme:` on its configuration still failed its
// fetch, while the same call on a fresh configuration serves bytes. Which schemes exist is not
// this file's business: whoever owns the handler registers them on the object returned here.

// The frame rect, built on the C stack so no struct crosses bun:ffi. Its own type, because
// `40_window.c` defines `shim_rect` later in the unit and two typedefs of one name collide.
typedef struct {
	double x, y, w, h;
} shim_web_rect;

obj_t shim_webview_configuration(void) {
	obj_t allocated = ((obj_t (*)(void *, void *))objc_msgSend)(
	    objc_getClass("WKWebViewConfiguration"), sel_registerName("alloc"));
	if (!allocated) return 0;
	return ((obj_t (*)(void *, void *))objc_msgSend)(allocated, sel_registerName("init"));
}

// A nil configuration is refused, not defaulted: the webview WebKit builds for itself is
// exactly the one no scheme handler can reach, so a silent fallback would hide the defect.
obj_t shim_webview_new(obj_t configuration, double w, double h) {
	obj_t allocated;
	shim_web_rect frame = {0, 0, w, h};
	if (!configuration) return 0;
	allocated = ((obj_t (*)(void *, void *))objc_msgSend)(objc_getClass("WKWebView"),
	                                                     sel_registerName("alloc"));
	if (!allocated) return 0;
	return ((obj_t (*)(void *, void *, shim_web_rect, obj_t))objc_msgSend)(
	    allocated, sel_registerName("initWithFrame:configuration:"), frame, configuration);
}

// --- URL chain, entirely inside C -----------------------------------------

long long shim_cstr_len(const char *p) {
	long long n = 0;
	while (p[n]) n++;
	return n;
}

// Loads a URL in a webview without ever handing an object across bun:ffi.
// Returns 1 on success, 0 if any step returned null. Encoding 4 is
// NSUTF8StringEncoding.
int shim_webview_load(obj_t web, const char *url) {
	obj_t allocd = ((obj_t (*)(void *, void *))objc_msgSend)(objc_getClass("NSString"),
	                                                        sel_registerName("alloc"));
	if (!allocd) return 0;
	obj_t nsstr = ((obj_t (*)(void *, void *, const char *, unsigned long,
	                          long long))objc_msgSend)(
	    allocd, sel_registerName("initWithBytes:length:encoding:"), url, (unsigned long)shim_cstr_len(url),
	    4LL);
	if (!nsstr) return 0;
	obj_t nsurl = ((obj_t (*)(void *, void *, obj_t))objc_msgSend)(
	    objc_getClass("NSURL"), sel_registerName("URLWithString:"), nsstr);
	if (!nsurl) return 0;
	obj_t req = ((obj_t (*)(void *, void *, obj_t))objc_msgSend)(
	    objc_getClass("NSURLRequest"), sel_registerName("requestWithURL:"), nsurl);
	if (!req) return 0;
	((obj_t (*)(void *, void *, obj_t))objc_msgSend)(web, sel_registerName("loadRequest:"), req);
	return 1;
}

// --- Auto Layout ----------------------------------------------------------

// +[NSLayoutConstraint constraintWithItem:attribute:relatedBy:toItem:attribute:multiplier:constant:]
// Seven scalars and objects, no struct. `item` must never be nil (AppKit raises).
obj_t shim_constraint(obj_t item, long long attr, long long rel, obj_t toItem, long long toAttr,
                      double mult, double c) {
	return ((obj_t (*)(void *, void *, void *, long long, long long, void *, long long, double,
	                   double))objc_msgSend)(objc_getClass("NSLayoutConstraint"),
	                                        sel_registerName("constraintWithItem:attribute:"
	                                                         "relatedBy:toItem:attribute:"
	                                                         "multiplier:constant:"),
	                                        item, attr, rel, toItem, toAttr, mult, c);
}

// The four-argument variant, which has no toItem at all — used for width and
// height so that a nil toItem never has to be sent.
obj_t shim_constraint_simple(obj_t item, long long attr, long long rel, double c) {
	return ((obj_t (*)(void *, void *, void *, long long, long long, double))objc_msgSend)(
	    objc_getClass("NSLayoutConstraint"),
	    sel_registerName("constraintWithItem:attribute:relatedBy:constant:"), item, attr, rel, c);
}

// --- struct-valued reads kept entirely inside C ---------------------------

// -[NSView valueForKey:](@"frame") returns an NSValue; -getValue: fills a
// CGRect. Both stay on the C stack: no struct crosses bun:ffi, and no out
// pointer is handed across it either. Callers ask for one component at a time:
// 0 = x, 1 = y, 2 = width, 3 = height.
double shim_frame_num(obj_t view, int component) {
	double nan = 0.0 / 0.0;
	obj_t key = __CFStringMakeConstantString("frame");
	if (!key) return nan;
	obj_t box = ((obj_t (*)(void *, void *, void *))objc_msgSend)(
	    view, sel_registerName("valueForKey:"), key);
	if (!box) return nan;
	double rect[4] = {0, 0, 0, 0};
	((void (*)(void *, void *, void *))objc_msgSend)(box, sel_registerName("getValue:"), rect);
	if (component < 0 || component > 3) return nan;
	return rect[component];
}

