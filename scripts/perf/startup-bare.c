// Scratch-only perf scaffold, compiled by bun:ffi cc() in startup-bare-native.ts.
// AppKit only: NSApplication, one NSWindow, one WKWebView. No crust runtime,
// bridge, content world or injected script unless a flag asks for one.
// Every objc_msgSend has a FIXED prototype; no struct crosses the FFI boundary.
typedef void *obj_t;
extern obj_t objc_msgSend(void *self, void *sel, ...);
extern obj_t objc_getClass(const char *name);
extern obj_t sel_registerName(const char *name);
extern obj_t __CFStringMakeConstantString(const char *cstr);
extern obj_t objc_allocateClassPair(obj_t parent, const char *name, unsigned long extra);
extern void objc_registerClassPair(obj_t cls);
extern char class_addMethod(obj_t cls, void *sel, void *imp, const char *types);
extern void NSApplicationLoad(void);

typedef struct {
	double x, y, width, height;
} bare_rect;

static obj_t bare_string(const char *text) {
	if (!text) text = "";
	return ((obj_t (*)(void *, void *, const char *))objc_msgSend)(
	    objc_getClass("NSString"), sel_registerName("stringWithUTF8String:"), text);
}

static obj_t bare_number_bool(int value) {
	obj_t number = ((obj_t (*)(void *, void *))objc_msgSend)(
	    objc_getClass("NSNumber"), sel_registerName("alloc"));
	return ((obj_t (*)(void *, void *, char))objc_msgSend)(
	    number, sel_registerName("initWithBool:"), value ? 1 : 0);
}

static void bare_noop(obj_t self, void *sel, obj_t view, obj_t task) {
}

static obj_t bare_window;
static obj_t bare_web;
static obj_t bare_config;
static obj_t bare_pool;
static obj_t bare_scheme;
static obj_t bare_activity;

/**
 * flags: 1 fresh WKProcessPool, 2 injected content-world scripts, 4 config
 * flag, 8 crust-net scheme handler, 16 crust's regular activation policy.
 * Scripts arrive from the
 * harness so their byte count is the one crust actually ships.
 */
long bare_create(int width, int height, int flags, const char *scriptA, const char *scriptB) {
	NSApplicationLoad();
	obj_t app = ((obj_t (*)(void *, void *))objc_msgSend)(
	    objc_getClass("NSApplication"), sel_registerName("sharedApplication"));
	// Crust's startAppKit sets 0 (regular). The floor uses 1 (accessory) so a
	// headless probe never asks to activate; flag 16 copies crust's value.
	((void (*)(void *, void *, long long))objc_msgSend)(
	    app, sel_registerName("setActivationPolicy:"), (flags & 16) ? 0 : 1);
	bare_config = ((obj_t (*)(void *, void *))objc_msgSend)(
	    objc_getClass("WKWebViewConfiguration"), sel_registerName("new"));
	if (flags & 1) {
		bare_pool = ((obj_t (*)(void *, void *))objc_msgSend)(
		    objc_getClass("WKProcessPool"), sel_registerName("new"));
		((void (*)(void *, void *, obj_t))objc_msgSend)(
		    bare_config, sel_registerName("setProcessPool:"), bare_pool);
	}
	if (flags & 2) {
		obj_t controller = ((obj_t (*)(void *, void *))objc_msgSend)(
		    bare_config, sel_registerName("userContentController"));
		obj_t world = ((obj_t (*)(void *, void *, obj_t))objc_msgSend)(
		    objc_getClass("WKContentWorld"), sel_registerName("worldWithName:"),
		    bare_string("crust-isolated"));
		obj_t page = ((obj_t (*)(void *, void *))objc_msgSend)(
		    objc_getClass("WKContentWorld"), sel_registerName("pageWorld"));
		const char *scripts[] = {scriptA, scriptB};
		obj_t worlds[] = {world, page};
		for (int i = 0; i < 2; i++) {
			if (!scripts[i] || !*scripts[i]) continue;
			obj_t source = bare_string(scripts[i]);
			obj_t allocated = ((obj_t (*)(void *, void *))objc_msgSend)(
			    objc_getClass("WKUserScript"), sel_registerName("alloc"));
			obj_t script = ((obj_t (*)(void *, void *, obj_t, long long, char, obj_t))objc_msgSend)(
			    allocated,
			    sel_registerName("initWithSource:injectionTime:forMainFrameOnly:inContentWorld:"),
			    source, 0, 1, worlds[i]);
			((void (*)(void *, void *, obj_t))objc_msgSend)(
			    controller, sel_registerName("addUserScript:"), script);
		}
	}
	if (flags & 4)
		((void (*)(void *, void *, char))objc_msgSend)(
		    bare_config, sel_registerName("setSuppressesIncrementalRendering:"), 1);
	if (flags & 8) {
		obj_t cls = objc_allocateClassPair(objc_getClass("NSObject"), "BareScheme", 0);
		class_addMethod(cls, sel_registerName("webView:startURLSchemeTask:"),
		    (void *)bare_noop, "v@:@@");
		class_addMethod(cls, sel_registerName("webView:stopURLSchemeTask:"),
		    (void *)bare_noop, "v@:@@");
		objc_registerClassPair(cls);
		bare_scheme = ((obj_t (*)(void *, void *))objc_msgSend)(cls, sel_registerName("new"));
		((void (*)(void *, void *, obj_t, obj_t))objc_msgSend)(
		    bare_config, sel_registerName("setURLSchemeHandler:forURLScheme:"), bare_scheme,
		    bare_string("crust-net"));
	}
	bare_rect rect = {120, 120, (double)width, (double)height};
	obj_t windowAlloc = ((obj_t (*)(void *, void *))objc_msgSend)(
	    objc_getClass("NSWindow"), sel_registerName("alloc"));
	// arm64 passes a struct of four doubles in four consecutive registers, so four
	// double arguments are ABI-identical and TinyCC does not need a struct by value.
	obj_t (*initWindow)(
	    void *, void *, double, double, double, double, unsigned long long, unsigned long long, char) =
	    (obj_t (*)(void *, void *, double, double, double, double, unsigned long long,
	        unsigned long long, char))objc_msgSend;
	bare_window = initWindow(windowAlloc,
	    sel_registerName("initWithContentRect:styleMask:backing:defer:"), rect.x, rect.y,
	    rect.width, rect.height, 15ULL, 2ULL, 0);
	if (!bare_window) return 0;
	((void (*)(void *, void *, char))objc_msgSend)(
	    bare_window, sel_registerName("setReleasedWhenClosed:"), 0);
	bare_rect zero = {0, 0, 0, 0};
	bare_rect frame = {0, 0, (double)width, (double)height};
	obj_t webAlloc = ((obj_t (*)(void *, void *))objc_msgSend)(
	    objc_getClass("WKWebView"), sel_registerName("alloc"));
	obj_t (*initWeb)(void *, void *, double, double, double, double, obj_t) =
	    (obj_t (*)(void *, void *, double, double, double, double, obj_t))objc_msgSend;
	bare_web = initWeb(webAlloc, sel_registerName("initWithFrame:configuration:"), zero.x,
	    zero.y, zero.width, zero.height, bare_config);
	if (!bare_web) return 0;
	obj_t content = ((obj_t (*)(void *, void *))objc_msgSend)(
	    bare_window, sel_registerName("contentView"));
	((void (*)(void *, void *, obj_t))objc_msgSend)(
	    content, sel_registerName("addSubview:"), bare_web);
	((void (*)(void *, void *, double, double, double, double))objc_msgSend)(
	    bare_web, sel_registerName("setFrame:"), frame.x, frame.y, frame.width, frame.height);
	((void (*)(void *, void *, unsigned long long))objc_msgSend)(
	    bare_web, sel_registerName("setAutoresizingMask:"), 18ULL);
	((void (*)(void *, void *, obj_t))objc_msgSend)(
	    bare_window, sel_registerName("orderFront:"), (obj_t)0);
	void *occlusion = sel_registerName("_setWindowOcclusionDetectionEnabled:");
	char responds = ((char (*)(void *, void *, void *))objc_msgSend)(
	    bare_web, sel_registerName("respondsToSelector:"), occlusion);
	if (responds)
		((void (*)(void *, void *, char))objc_msgSend)(bare_web, occlusion, 0);
	obj_t info = ((obj_t (*)(void *, void *))objc_msgSend)(
	    objc_getClass("NSProcessInfo"), sel_registerName("processInfo"));
	bare_activity = ((obj_t (*)(void *, void *, unsigned long long, obj_t))objc_msgSend)(
	    info, sel_registerName("beginActivityWithOptions:reason:"), 0x00FFFFFFULL,
	    bare_string("crust-startup-bare-probe"));
	return (long)bare_web;
}

/** Diagnostic that never crosses FFI with a string: proves the webview can load. */
void bare_load_sync(void) {
	obj_t html = __CFStringMakeConstantString(
	    "<!doctype html><html><head><title>x</title></head>"
	    "<body><script>document.title='DONE'</script></body></html>");
	((void (*)(void *, void *, obj_t, obj_t))objc_msgSend)(
	    bare_web, sel_registerName("loadHTMLString:baseURL:"), html, (obj_t)0);
}

void bare_load_html(const char *html) {
	((void (*)(void *, void *, obj_t, obj_t))objc_msgSend)(
	    bare_web, sel_registerName("loadHTMLString:baseURL:"), bare_string(html), (obj_t)0);
}

void bare_load_url(const char *url) {
	obj_t nsurl = ((obj_t (*)(void *, void *, obj_t))objc_msgSend)(
	    objc_getClass("NSURL"), sel_registerName("URLWithString:"), bare_string(url));
	obj_t request = ((obj_t (*)(void *, void *, obj_t))objc_msgSend)(
	    objc_getClass("NSURLRequest"), sel_registerName("requestWithURL:"), nsurl);
	((void (*)(void *, void *, obj_t))objc_msgSend)(
	    bare_web, sel_registerName("loadRequest:"), request);
}

/** Drain AppKit once; Bun's own event loop does not run NSRunLoop. */
void bare_pump(void) {
	obj_t date = ((obj_t (*)(void *, void *, double))objc_msgSend)(
	    objc_getClass("NSDate"), sel_registerName("dateWithTimeIntervalSinceNow:"), 0.005);
	obj_t loop = ((obj_t (*)(void *, void *))objc_msgSend)(
	    objc_getClass("NSRunLoop"), sel_registerName("currentRunLoop"));
	obj_t mode = __CFStringMakeConstantString("kCFRunLoopDefaultMode");
	((void (*)(void *, void *, obj_t, obj_t))objc_msgSend)(
	    loop, sel_registerName("runMode:beforeDate:"), mode, date);
}

int bare_done(void) {
	obj_t title = ((obj_t (*)(void *, void *))objc_msgSend)(
	    bare_web, sel_registerName("title"));
	if (!title) return 0;
	return ((char (*)(void *, void *, obj_t))objc_msgSend)(
	    title, sel_registerName("isEqualToString:"), bare_string("DONE"));
}

void bare_destroy(void) {
	((void (*)(void *, void *))objc_msgSend)(bare_window, sel_registerName("close"));
}
