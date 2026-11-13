// crust macOS shim — compiled at launch by bun:ffi's cc().
//
// Ported from spike/shim.c, which is measured working. Rules this file obeys,
// each one measured (research/cc.md, research/objc.md, DESIGN.md §2):
//
//  1. EVERY objc_msgSend call site casts to a FIXED prototype. A plain
//     `extern void *objc_msgSend(void *, void *, ...)` compiles and runs, and
//     delivers wrong argument values with no diagnostic (41 arrived as
//     1806466472). Zero-argument sends happen to survive; nothing else does.
//  2. No framework headers. <AppKit/AppKit.h> and <Foundation/Foundation.h> are
//     unreachable from TinyCC with or without -I/-F, so every symbol is a
//     hand-written extern over void *.
//  3. No struct crosses the export boundary. CGRect is only ever built and read
//     inside this file; JS sees scalars and pointers.
//  4. Nothing here builds an NSString from a short string. A short ASCII
//     NSString is a tagged pointer that cannot survive bun:ffi's number
//     round-trip, and `+[NSString stringWithUTF8String:]` aborts Bun outright.
//     Strings stay in C: the URL chain in shim_webview_load uses
//     -initWithBytes:length:encoding: on an alloc'd NSString.
//
// Deliberately absent, each a measured crash or a dead path: the title, the
// string intern table, and every NSString helper that returned an object across
// the boundary (shim_string, shim_nsstring_from_data, shim_data).

typedef void *obj_t;

extern obj_t objc_msgSend(void *self, void *sel, ...);
extern obj_t objc_getClass(const char *name);
extern obj_t sel_registerName(const char *name);
extern void *class_getInstanceMethod(void *cls, void *sel);
extern void *object_getClass(void *obj);
extern const char *class_getName(void *cls);
extern int NSApplicationLoad(void);
extern int CFRunLoopRunInMode(void *mode, double seconds, int returnAfterSourceHandled);
extern obj_t __CFStringMakeConstantString(const char *cstr);
extern int CFStringGetCString(void *s, char *buf, long size, unsigned int encoding);

// --- runtime handles -------------------------------------------------------

obj_t shim_cls(const char *name) { return objc_getClass(name); }
obj_t shim_sel(const char *name) { return sel_registerName(name); }

obj_t shim_object_class(obj_t obj) { return object_getClass(obj); }

// Class name of an object's class, or of a class object itself.
const char *shim_class_name(obj_t obj) {
	void *c = object_getClass(obj);
	if (!c) return "(null)";
	const char *n = class_getName(c);
	return n ? n : "(null)";
}

const char *shim_name_of_class(void *cls) {
	const char *n = class_getName(cls);
	return n ? n : "(null)";
}

void *shim_instance_method(void *cls, obj_t sel) { return class_getInstanceMethod(cls, sel); }

// [obj respondsToSelector:sel] — the only existence test that is safe on an
// instance, and the honest one on a class object.
int shim_responds(obj_t obj, obj_t candidate) {
	obj_t s = sel_registerName("respondsToSelector:");
	if (!s) return 0;
	return (int)((char (*)(void *, void *, void *))objc_msgSend)(obj, s, candidate);
}

// --- sends, one fixed prototype per arity/shape ----------------------------

obj_t shim_send_p0(obj_t r, obj_t s) {
	return ((obj_t (*)(void *, void *))objc_msgSend)(r, s);
}
obj_t shim_send_p1(obj_t r, obj_t s, obj_t a) {
	return ((obj_t (*)(void *, void *, void *))objc_msgSend)(r, s, a);
}
obj_t shim_send_p2(obj_t r, obj_t s, obj_t a, obj_t b) {
	return ((obj_t (*)(void *, void *, void *, void *))objc_msgSend)(r, s, a, b);
}
obj_t shim_send_p3(obj_t r, obj_t s, obj_t a, obj_t b, obj_t c) {
	return ((obj_t (*)(void *, void *, void *, void *, void *))objc_msgSend)(r, s, a, b, c);
}
obj_t shim_send_pq1(obj_t r, obj_t s, long long v) {
	return ((obj_t (*)(void *, void *, long long))objc_msgSend)(r, s, v);
}
obj_t shim_send_pb1(obj_t r, obj_t s, int v) {
	return ((obj_t (*)(void *, void *, int))objc_msgSend)(r, s, v);
}
obj_t shim_send_pd1(obj_t r, obj_t s, double v) {
	return ((obj_t (*)(void *, void *, double))objc_msgSend)(r, s, v);
}

// BOOL returns are 1 byte in w0; read them as char, never as a pointer.
int shim_send_b0(obj_t r, obj_t s) {
	return (int)(char)((char (*)(void *, void *))objc_msgSend)(r, s);
}
int shim_send_b1(obj_t r, obj_t s, obj_t a) {
	return (int)(char)((char (*)(void *, void *, void *))objc_msgSend)(r, s, a);
}

// long long / unsigned long long returns (styleMask, windowNumber, policy).
long long shim_send_q0(obj_t r, obj_t s) {
	return ((long long (*)(void *, void *))objc_msgSend)(r, s);
}
long long shim_send_q1(obj_t r, obj_t s, long long v) {
	return ((long long (*)(void *, void *, long long))objc_msgSend)(r, s, v);
}

void shim_send_v0(obj_t r, obj_t s) {
	((void (*)(void *, void *))objc_msgSend)(r, s);
}
void shim_send_v1(obj_t r, obj_t s, obj_t a) {
	((void (*)(void *, void *, void *))objc_msgSend)(r, s, a);
}
void shim_send_v2(obj_t r, obj_t s, obj_t a, obj_t b) {
	((void (*)(void *, void *, void *, void *))objc_msgSend)(r, s, a, b);
}
void shim_send_vb1(obj_t r, obj_t s, int v) {
	((void (*)(void *, void *, int))objc_msgSend)(r, s, v);
}
void shim_send_vq1(obj_t r, obj_t s, long long v) {
	((void (*)(void *, void *, long long))objc_msgSend)(r, s, v);
}
void shim_send_vd1(obj_t r, obj_t s, double v) {
	((void (*)(void *, void *, double))objc_msgSend)(r, s, v);
}

// [[cls alloc] init] — the struct-free constructor pair.
obj_t shim_new(obj_t cls) {
	obj_t a = sel_registerName("alloc");
	obj_t i = sel_registerName("init");
	obj_t o = ((obj_t (*)(void *, void *))objc_msgSend)(cls, a);
	return o ? ((obj_t (*)(void *, void *))objc_msgSend)(o, i) : 0;
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

// --- window ---------------------------------------------------------------

// `-[NSWindow init]` does not exist. The designated initializer is
// initWithContentRect:styleMask:backing:defer:, and a bare init returns a
// half-built window that AppKit's own event thread later messages, which aborts
// the process with doesNotRecognizeSelector: on _NSEventThread. The rect is
// built on the C stack so no struct crosses bun:ffi.
typedef struct {
	double x, y, w, h;
} shim_rect;

obj_t shim_window_new(double x, double y, double w, double h, long long style,
                      long long backing, int defer) {
	obj_t w0 = ((obj_t (*)(void *, void *))objc_msgSend)(
	    objc_getClass("NSWindow"), sel_registerName("alloc"));
	if (!w0) return 0;
	shim_rect r = {x, y, w, h};
	return ((obj_t (*)(void *, void *, shim_rect, long long, long long, int))objc_msgSend)(
	    w0, sel_registerName("initWithContentRect:styleMask:backing:defer:"), r, style, backing,
	    defer);
}

// Titles are set from C as well: a short ASCII NSString is a tagged pointer and
// cannot cross bun:ffi, so the string is built and consumed on this side.
void shim_window_set_title(obj_t win, const char *title) {
	if (!win || !title) return;
	obj_t allocd = ((obj_t (*)(void *, void *))objc_msgSend)(objc_getClass("NSString"),
	                                                        sel_registerName("alloc"));
	if (!allocd) return;
	obj_t s = ((obj_t (*)(void *, void *, const char *, unsigned long,
	                      long long))objc_msgSend)(
	    allocd, sel_registerName("initWithBytes:length:encoding:"), title,
	    (unsigned long)shim_cstr_len(title), 4LL);
	if (!s) return;
	((void (*)(void *, void *, obj_t))objc_msgSend)(win, sel_registerName("setTitle:"), s);
}

// The window's own title, decoded back to C so JS can verify what was applied.
const char *shim_window_title_utf8(obj_t win) {
	if (!win) return "";
	obj_t t = ((obj_t (*)(void *, void *))objc_msgSend)(win, sel_registerName("title"));
	if (!t) return "";
	return ((const char *(*)(void *, void *))objc_msgSend)(t, sel_registerName("UTF8String"));
}

// --- window liveness ------------------------------------------------------
//
// Read from C, not through the arity ladder, because these four are the whole
// evidence for "this window is gone" and each must be one guarded send with a
// fixed prototype. `-windowNumber` is the liveness test: a minimised window
// still reports a number, a closed one reports 0. `-isVisible` is not, because
// it is false for a minimised window too.

long long shim_window_number(obj_t win) {
	if (!win) return 0;
	return ((long long (*)(void *, void *))objc_msgSend)(win, sel_registerName("windowNumber"));
}

int shim_window_is_visible(obj_t win) {
	if (!win) return 0;
	if (!class_getInstanceMethod(object_getClass(win), sel_registerName("isVisible"))) return 0;
	return (int)(char)((char (*)(void *, void *))objc_msgSend)(win, sel_registerName("isVisible"));
}

int shim_window_is_released_when_closed(obj_t win) {
	if (!win) return 0;
	if (!class_getInstanceMethod(object_getClass(win),
	                              sel_registerName("isReleasedWhenClosed")))
		return 0;
	return (int)(char)((char (*)(void *, void *))objc_msgSend)(
	    win, sel_registerName("isReleasedWhenClosed"));
}

int shim_window_is_key(obj_t win) {
	if (!win) return 0;
	if (!class_getInstanceMethod(object_getClass(win), sel_registerName("isKeyWindow"))) return 0;
	return (int)(char)((char (*)(void *, void *))objc_msgSend)(win, sel_registerName("isKeyWindow"));
}

// A minimised window is not visible and is still open, so liveness needs this
// beside -isVisible. Measured 2026-11-13: -windowNumber keeps the window device
// number after -close, so it cannot answer "is this window gone".
int shim_window_is_miniaturized(obj_t win) {
	if (!win) return 0;
	if (!class_getInstanceMethod(object_getClass(win),
	                             sel_registerName("isMiniaturized")))
		return 0;
	return (int)(char)((char (*)(void *, void *))objc_msgSend)(
	    win, sel_registerName("isMiniaturized"));
}

// A minimum content size, so a window cannot be dragged smaller than the config
// allows. NSSize is two doubles and stays on the C stack.
typedef struct {
	double w, h;
} shim_size;

void shim_window_set_min_size(obj_t win, double w, double h) {
	if (!win) return;
	shim_size s = {w, h};
	((void (*)(void *, void *, shim_size))objc_msgSend)(win,
	                                                   sel_registerName("setContentMinSize:"), s);
}

// --- application ----------------------------------------------------------

int shim_app_load(void) { return (int)NSApplicationLoad(); }

obj_t shim_pool_new(void) {
	obj_t poolCls = objc_getClass("NSAutoreleasePool");
	if (!poolCls) return 0;
	return ((obj_t (*)(void *, void *))objc_msgSend)(poolCls, sel_registerName("alloc"));
}
obj_t shim_pool_init(obj_t pool) {
	return ((obj_t (*)(void *, void *))objc_msgSend)(pool, sel_registerName("init"));
}
void shim_pool_drain(obj_t pool) {
	((void (*)(void *, void *))objc_msgSend)(pool, sel_registerName("drain"));
}

// --- run loop -------------------------------------------------------------

// kCFRunLoopDefaultMode is a data symbol and cannot be called through bun:ffi
// (a zero-arg declaration executes the bytes there and dies with a bus error).
// A constant CFString is content-equal to the canonical one; verify by content.
obj_t shim_mode(void) { return __CFStringMakeConstantString("kCFRunLoopDefaultMode"); }

int shim_mode_ok(obj_t mode) {
	if (!mode) return 0;
	char buf[64];
	buf[0] = 0;
	if (!CFStringGetCString(mode, buf, 64, 0x08000100 /* kCFStringEncodingUTF8 */)) return 0;
	const char *want = "kCFRunLoopDefaultMode";
	long i = 0;
	while (want[i]) {
		if (buf[i] != want[i]) return 0;
		i++;
	}
	return buf[i] == 0 ? 1 : 0;
}

// The pump: one 0.25 ms slice. The slice length is what decides tick fidelity —
// 4 ms delivered only 82.4% of a 16 ms tick (DESIGN.md §3).
int shim_pump(obj_t mode) { return CFRunLoopRunInMode(mode, 0.00025, 1); }

// --- open panel (NSOpenPanel) ---------------------------------------------
//
// No object of any kind crosses bun:ffi here. A file path is routinely short
// ASCII, and a short ASCII NSString is a tagged pointer above 2^53, so the
// panel's URLs are decoded and copied into C-side storage and JS reads an int
// status plus a copied `const char *`. See the traps in DESIGN.md §2.
//
// Status codes, mirrored by PANEL_STATUS in index.ts:
#define SHIM_PANEL_PICKED 0        // modal pick finished with >= 1 path
#define SHIM_PANEL_CANCELLED 1     // modal pick finished with no path
#define SHIM_PANEL_UNSUPPORTED 2   // NSOpenPanel, or a selector it needs, is absent
#define SHIM_PANEL_SHEET_STARTED 3 // beginSheet... accepted; nothing waits for it
#define SHIM_PANEL_NO_WINDOW 4     // sheet asked for with no key window

#define SHIM_PANEL_MAX_PATHS 32
#define SHIM_PANEL_PATH_BYTES 4096

static char panel_paths[SHIM_PANEL_MAX_PATHS][SHIM_PANEL_PATH_BYTES];
static int panel_paths_used;

// One NSString, built and consumed on this side. Encoding 4 is
// NSUTF8StringEncoding, and `-initWithBytes:length:encoding:` is what the
// measured URL chain uses: `+stringWithUTF8String:` aborts Bun outright.
static obj_t panel_nsstring(const char *s) {
	if (!s || !s[0]) return 0;
	obj_t allocd = ((obj_t (*)(void *, void *))objc_msgSend)(objc_getClass("NSString"),
	                                                        sel_registerName("alloc"));
	if (!allocd) return 0;
	return ((obj_t (*)(void *, void *, const char *, unsigned long, long long))objc_msgSend)(
	    allocd, sel_registerName("initWithBytes:length:encoding:"), s,
	    (unsigned long)shim_cstr_len(s), 4LL);
}

// Guard for every selector this section sends. An uncaught ObjC exception
// kills the process with no JS error, so nothing is sent unchecked.
static int panel_has_instance(const char *cls, const char *selname) {
	void *c = objc_getClass(cls);
	if (!c) return 0;
	return class_getInstanceMethod(c, sel_registerName(selname)) != 0;
}

static void panel_reset(void) {
	panel_paths_used = 0;
	panel_paths[0][0] = 0;
}

static void panel_copy_path(const char *src) {
	if (!src || panel_paths_used >= SHIM_PANEL_MAX_PATHS) return;
	char *dst = panel_paths[panel_paths_used];
	long i = 0;
	while (src[i] && i < SHIM_PANEL_PATH_BYTES - 1) {
		dst[i] = src[i];
		i++;
	}
	dst[i] = 0;
	panel_paths_used++;
}

// -[NSOpenPanel URLs] -> each -path -> -UTF8String, copied into static storage.
static void panel_collect(obj_t panel) {
	obj_t urls = ((obj_t (*)(void *, void *))objc_msgSend)(panel, sel_registerName("URLs"));
	if (!urls) return;
	unsigned long long n = ((unsigned long long (*)(void *, void *))objc_msgSend)(
	    urls, sel_registerName("count"));
	for (unsigned long long i = 0; i < n; i++) {
		obj_t url = ((obj_t (*)(void *, void *, unsigned long long))objc_msgSend)(
		    urls, sel_registerName("objectAtIndex:"), i);
		if (!url) continue;
		obj_t path = ((obj_t (*)(void *, void *))objc_msgSend)(url, sel_registerName("path"));
		if (!path) continue;
		const char *utf8 = ((const char *(*)(void *, void *))objc_msgSend)(
		    path, sel_registerName("UTF8String"));
		panel_copy_path(utf8);
	}
}

// The window a sheet attaches to. `-keyWindow` is nil whenever the process is
// not the active app — which an unbundled `bun` process frequently is, because
// macOS 14+ restricts self-activation — so falling back to the main window and
// then the first visible window is what makes a picker work from the background
// rather than answer "no window". A sheet on an off-screen window raises, so
// the fallback only accepts a visible one.
static obj_t panel_visible_window(obj_t app) {
	if (!panel_has_instance("NSApplication", "windows")) return 0;
	obj_t list =
	    ((obj_t (*)(void *, void *))objc_msgSend)(app, sel_registerName("windows"));
	if (!list) return 0;
	int guarded = panel_has_instance("NSWindow", "isVisible");
	unsigned long long n = ((unsigned long long (*)(void *, void *))objc_msgSend)(
	    list, sel_registerName("count"));
	for (unsigned long long i = 0; i < n; i++) {
		obj_t w = ((obj_t (*)(void *, void *, unsigned long long))objc_msgSend)(
		    list, sel_registerName("objectAtIndex:"), i);
		if (!w) continue;
		if (!guarded) return w;
		if ((char)((char (*)(void *, void *))objc_msgSend)(w, sel_registerName("isVisible")))
			return w;
	}
	return 0;
}

static obj_t panel_sheet_window(obj_t app) {
	obj_t w = 0;
	if (panel_has_instance("NSApplication", "keyWindow"))
		w = ((obj_t (*)(void *, void *))objc_msgSend)(app, sel_registerName("keyWindow"));
	if (!w && panel_has_instance("NSApplication", "mainWindow"))
		w = ((obj_t (*)(void *, void *))objc_msgSend)(app, sel_registerName("mainWindow"));
	if (!w) w = panel_visible_window(app);
	return w;
}

// Opens an NSOpenPanel.
//
//   runModal = 1  calls -runModal and BLOCKS this thread until the user answers.
//                 Called from JS that stops the JavaScript thread and the Cocoa
//                 pump for the duration; accepted for a file picker, and stated
//                 as blocking rather than dressed up as async.
//   runModal = 0  calls -beginSheetModalForWindow:completionHandler: with a NULL
//                 completion and returns at once. Nothing ever reports the
//                 sheet's result, so it can only start one, never collect paths.
//                 With no key window there is nothing to attach a sheet to and
//                 this returns SHIM_PANEL_NO_WINDOW without sending.
int shim_open_panel(const char *title, const char *types, int allowDirectories, int allowMultiple,
                    int runModal) {
	panel_reset();

	// The panel class and its factory must exist before anything is built.
	if (!objc_getClass("NSOpenPanel")) return SHIM_PANEL_UNSUPPORTED;
	if (!shim_responds((obj_t)objc_getClass("NSOpenPanel"),
	                   sel_registerName("openPanel")))
		return SHIM_PANEL_UNSUPPORTED;

	// A sheet needs a window first: sending beginSheet… with a nil window is an
	// AppKit exception, and an exception here is a crashed process.
	obj_t sheet_window = 0;
	if (!runModal) {
		obj_t app = 0;
		if (shim_responds((obj_t)objc_getClass("NSApplication"),
		                  sel_registerName("sharedApplication"))) {
			app = ((obj_t (*)(void *, void *))objc_msgSend)(objc_getClass("NSApplication"),
			                                               sel_registerName("sharedApplication"));
		}
		if (!app) return SHIM_PANEL_NO_WINDOW;
		if (!panel_has_instance("NSOpenPanel", "beginSheetModalForWindow:completionHandler:"))
			return SHIM_PANEL_UNSUPPORTED;
		sheet_window = panel_sheet_window(app);
		if (!sheet_window) return SHIM_PANEL_NO_WINDOW;
	}

	obj_t panel = ((obj_t (*)(void *, void *))objc_msgSend)(objc_getClass("NSOpenPanel"),
	                                                        sel_registerName("openPanel"));
	if (!panel) return SHIM_PANEL_UNSUPPORTED;

	// Selection shape. Both flags are BOOL parameters, sent as an int exactly
	// like shim_send_vb1 does; every one is guarded first.
	if (!panel_has_instance("NSOpenPanel", "setCanChooseFiles:") ||
	    !panel_has_instance("NSOpenPanel", "setCanChooseDirectories:") ||
	    !panel_has_instance("NSOpenPanel", "setAllowsMultipleSelection:"))
		return SHIM_PANEL_UNSUPPORTED;
	((void (*)(void *, void *, int))objc_msgSend)(
	    panel, sel_registerName("setCanChooseFiles:"), allowDirectories ? 0 : 1);
	((void (*)(void *, void *, int))objc_msgSend)(
	    panel, sel_registerName("setCanChooseDirectories:"), allowDirectories ? 1 : 0);
	((void (*)(void *, void *, int))objc_msgSend)(
	    panel, sel_registerName("setAllowsMultipleSelection:"), allowMultiple ? 1 : 0);

	if (title && title[0] && panel_has_instance("NSOpenPanel", "setTitle:")) {
		obj_t t = panel_nsstring(title);
		if (t) ((void (*)(void *, void *, obj_t))objc_msgSend)(panel, sel_registerName("setTitle:"), t);
	}

	// File-type filters, comma-separated because a JS array cannot cross the
	// boundary. `-setAllowedFileTypes:` is deprecated but present on macOS 27; a
	// missing selector leaves the panel unfiltered rather than aborting the pick.
	if (types && types[0] && panel_has_instance("NSOpenPanel", "setAllowedFileTypes:")) {
		obj_t array = 0;
		obj_t cls = objc_getClass("NSMutableArray");
		if (cls) array = ((obj_t (*)(void *, void *))objc_msgSend)(cls, sel_registerName("array"));
		if (array) {
			const char *cursor = types;
			while (*cursor) {
				char item[64];
				long n = 0;
				while (*cursor && *cursor != ',' && n < (long)sizeof(item) - 1)
					item[n++] = *cursor++;
				item[n] = 0;
				if (*cursor == ',') cursor++;
				const char *ext = item;
				while (*ext == '*' || *ext == '.') ext++;
				if (!*ext) continue;
				obj_t s = panel_nsstring(ext);
				if (s)
					((void (*)(void *, void *, obj_t))objc_msgSend)(
					    array, sel_registerName("addObject:"), s);
			}
			((void (*)(void *, void *, obj_t))objc_msgSend)(
			    panel, sel_registerName("setAllowedFileTypes:"), array);
		}
	}

	if (!runModal) {
		((void (*)(void *, void *, obj_t, obj_t))objc_msgSend)(
		    panel, sel_registerName("beginSheetModalForWindow:completionHandler:"), sheet_window,
		    (obj_t)0);
		return SHIM_PANEL_SHEET_STARTED;
	}

	if (!panel_has_instance("NSOpenPanel", "runModal")) return SHIM_PANEL_UNSUPPORTED;
	long long response =
	    ((long long (*)(void *, void *))objc_msgSend)(panel, sel_registerName("runModal"));
	if (response != 1 /* NSModalResponseOK */) return SHIM_PANEL_CANCELLED;

	panel_collect(panel);
	return panel_paths_used > 0 ? SHIM_PANEL_PICKED : SHIM_PANEL_CANCELLED;
}

int shim_open_panel_count(void) { return panel_paths_used; }

// The path at `index`, or "" out of range. Static storage: valid until the next
// shim_open_panel call, which is all a caller needs.
const char *shim_open_panel_path(int index) {
	if (index < 0 || index >= panel_paths_used) return "";
	return panel_paths[index];
}
