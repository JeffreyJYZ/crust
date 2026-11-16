// --- network probe: a real WKWebView over the crust-net scheme --------------
// Compiled only by `network-probe.ts`, never at app launch and never into the window shim, so the
// handler unit stays handler-only. It builds a WKWebView from a configuration the caller registered
// the scheme handler on, loads a URL through that scheme, pumps the run loop and reads the page's
// title back — the four things a proof needs and no shipped module does.
// The rect is built on the C stack so no struct crosses bun:ffi.

typedef void *obj_t;

extern obj_t objc_msgSend(void *self, void *sel, ...);
extern obj_t objc_getClass(const char *name);
extern obj_t sel_registerName(const char *name);

typedef struct {
	double x, y, w, h;
} net_rect;

// 1 when AppKit answers; a probe with no NSApplication has no run loop to pump. `finishLaunching`
// and an accessory activation policy are what a real app does before `-run`: without them WebKit
// commits the navigation and never attaches a content process, so a served page renders nothing.
int net_probe_app(void) {
	obj_t application = ((obj_t (*)(void *, void *))objc_msgSend)(objc_getClass("NSApplication"),
	                                                             sel_registerName(
	                                                                 "sharedApplication"));
	if (!application) return 0;
	((void (*)(void *, void *))objc_msgSend)(application, sel_registerName("finishLaunching"));
	// NSApplicationActivationPolicyAccessory = 1: no Dock tile and no menu bar takeover.
	((void (*)(void *, void *, long long))objc_msgSend)(
	    application, sel_registerName("setActivationPolicy:"), 1LL);
	return 1;
}

// A fresh configuration, before any webview has used it — the only moment a handler is accepted.
obj_t net_probe_config(void) {
	obj_t allocated = ((obj_t (*)(void *, void *))objc_msgSend)(
	    objc_getClass("WKWebViewConfiguration"), sel_registerName("alloc"));
	if (!allocated) return 0;
	return ((obj_t (*)(void *, void *))objc_msgSend)(allocated, sel_registerName("init"));
}

obj_t net_probe_webview(obj_t configuration, double w, double h) {
	obj_t allocated;
	net_rect frame = {0, 0, w, h};
	if (!configuration) return 0;
	allocated = ((obj_t (*)(void *, void *))objc_msgSend)(objc_getClass("WKWebView"),
	                                                     sel_registerName("alloc"));
	if (!allocated) return 0;
	return ((obj_t (*)(void *, void *, net_rect, obj_t))objc_msgSend)(
	    allocated, sel_registerName("initWithFrame:configuration:"), frame, configuration);
}

// A window the webview lives in, never ordered front: a WKWebView outside a window loads and paints
// nothing, so its script never runs and the proof would stop at "bytes were handed to WebKit".
// styleMask 0 is borderless, so nothing is drawn even if the window were shown.
obj_t net_probe_window(obj_t web, double w, double h) {
	obj_t allocated, win;
	// Off every display: `orderFrontRegardless` does not activate the app, and -4000,-4000 is off
	// the virtual desktop, so the window is visible to WebKit and appears nowhere.
	net_rect frame = {-4000, -4000, w, h};
	if (!web) return 0;
	allocated = ((obj_t (*)(void *, void *))objc_msgSend)(objc_getClass("NSWindow"),
	                                                     sel_registerName("alloc"));
	if (!allocated) return 0;
	win = ((obj_t (*)(void *, void *, net_rect, long long, long long, int))objc_msgSend)(
	    allocated, sel_registerName("initWithContentRect:styleMask:backing:defer:"), frame, 0LL, 2LL,
	    0);
	if (!win) return 0;
	// A closed window must stay addressable, and this one is never closed by the probe.
	((void (*)(void *, void *, int))objc_msgSend)(win, sel_registerName("setReleasedWhenClosed:"),
	                                              0);
	((void (*)(void *, void *, obj_t))objc_msgSend)(win, sel_registerName("setContentView:"), web);
	return win;
}

// WebKit runs a page only once its view is in a VISIBLE window, so this is not optional.
int net_probe_show(obj_t win) {
	if (!win) return 0;
	((void (*)(void *, void *))objc_msgSend)(win, sel_registerName("orderFrontRegardless"));
	return (int)(char)((char (*)(void *, void *))objc_msgSend)(win, sel_registerName("isVisible"));
}

// The URL is built on this side: a short ASCII NSString is a tagged pointer and cannot cross ffi.
int net_probe_load(obj_t web, const char *url) {
	obj_t allocated, text, nsurl, request;
	long len = 0;
	if (!web || !url) return 0;
	while (url[len]) len++;
	allocated = ((obj_t (*)(void *, void *))objc_msgSend)(objc_getClass("NSString"),
	                                                     sel_registerName("alloc"));
	if (!allocated) return 0;
	text = ((obj_t (*)(void *, void *, const char *, unsigned long, long long))objc_msgSend)(
	    allocated, sel_registerName("initWithBytes:length:encoding:"), url, (unsigned long)len, 4LL);
	if (!text) return 0;
	nsurl = ((obj_t (*)(void *, void *, obj_t))objc_msgSend)(objc_getClass("NSURL"),
	                                                        sel_registerName("URLWithString:"), text);
	if (!nsurl) return 0;
	request = ((obj_t (*)(void *, void *, obj_t))objc_msgSend)(objc_getClass("NSURLRequest"),
	                                                          sel_registerName("requestWithURL:"),
	                                                          nsurl);
	if (!request) return 0;
	((void (*)(void *, void *, obj_t))objc_msgSend)(web, sel_registerName("loadRequest:"), request);
	return 1;
}

// -[WKWebView title] as a byte range: a cstring return is refused by bun:ffi.
int net_probe_title(obj_t web, char *dst, int cap) {
	obj_t title;
	const char *bytes;
	int i = 0;
	if (!web || !dst || cap <= 0) return -1;
	title = ((obj_t (*)(void *, void *))objc_msgSend)(web, sel_registerName("title"));
	if (!title) {
		dst[0] = 0;
		return 0;
	}
	bytes = ((const char *(*)(void *, void *))objc_msgSend)(title, sel_registerName("UTF8String"));
	if (!bytes) {
		dst[0] = 0;
		return 0;
	}
	while (bytes[i] && i < cap - 1) {
		dst[i] = bytes[i];
		i++;
	}
	dst[i] = 0;
	return i;
}

// Turn the run loop for a while: WebKit answers on it, so a probe that never pumps sees nothing.
void net_probe_pump(double seconds) {
	obj_t pool = ((obj_t (*)(void *, void *))objc_msgSend)(objc_getClass("NSAutoreleasePool"),
	                                                       sel_registerName("new"));
	obj_t until = ((obj_t (*)(void *, void *, double))objc_msgSend)(
	    objc_getClass("NSDate"), sel_registerName("dateWithTimeIntervalSinceNow:"), seconds);
	obj_t loop = ((obj_t (*)(void *, void *))objc_msgSend)(objc_getClass("NSRunLoop"),
	                                                      sel_registerName("currentRunLoop"));
	if (until && loop)
		((void (*)(void *, void *, obj_t))objc_msgSend)(loop, sel_registerName("runUntilDate:"),
		                                                until);
	if (pool) ((void (*)(void *, void *))objc_msgSend)(pool, sel_registerName("drain"));
}
