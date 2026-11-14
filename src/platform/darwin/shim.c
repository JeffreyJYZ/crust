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
extern void *CFRunLoopGetMain(void);
extern void *CFRunLoopGetCurrent(void);
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

// Is the window on the Space the user is looking at? A window on another Space is drawn
// nowhere, so `screencapture -l` returns an empty frame and the user sees nothing — which
// looks exactly like a rendering bug and is not one.
int shim_window_is_on_active_space(obj_t win) {
	if (!win) return -1;
	if (!class_getInstanceMethod(object_getClass(win), sel_registerName("isOnActiveSpace")))
		return -1;
	return (int)(char)((char (*)(void *, void *))objc_msgSend)(
	    win, sel_registerName("isOnActiveSpace"));
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
//
// `CFRunLoopRunInMode` alone does not draw: a page painted, kept running, and its window went
// blank while the pump kept ticking and the run loop kept reporting "timed out, no sources"
// (measured with a heartbeat page that kept invoking while nothing was visible). AppKit's own
// loop is the difference, so each tick drains the event queue the way BunKit does — mask, a
// deadline, `sendEvent:`, then `updateWindows` — and falls back to the run-loop slice.
// `NSDefaultRunLoopMode` is content-equal to `kCFRunLoopDefaultMode`, which is why the same
// constant string works for both calls.
static obj_t shim_default_mode(void) { return __CFStringMakeConstantString("kCFRunLoopDefaultMode"); }

// Does this thread own the main run loop? If it does not, pumping here can never drive
// AppKit's rendering, and no amount of slice tuning will help.
int shim_on_main_runloop(void) { return CFRunLoopGetMain() == CFRunLoopGetCurrent(); }

int shim_pump(obj_t mode) {
	if (!mode) mode = shim_default_mode();
	obj_t app = ((obj_t (*)(void *, void *))objc_msgSend)(
	    objc_getClass("NSApplication"), sel_registerName("sharedApplication"));
	if (!app) return CFRunLoopRunInMode(mode, 0.004, 0);

	obj_t deadline = ((obj_t (*)(void *, void *))objc_msgSend)(objc_getClass("NSDate"),
	                                                          sel_registerName("date"));
	if (deadline) deadline = ((obj_t (*)(void *, void *, double))objc_msgSend)(
	    deadline, sel_registerName("dateByAddingTimeInterval:"), 0.004);

	obj_t event = ((obj_t (*)(void *, void *, unsigned long, obj_t, obj_t, signed char))
	                   objc_msgSend)(
	    app, sel_registerName("nextEventMatchingMask:untilDate:inMode:dequeue:"), ~0UL,
	    deadline, mode, 1);
	if (event) {
		((void (*)(void *, void *, obj_t))objc_msgSend)(app, sel_registerName("sendEvent:"),
		                                               event);
		((void (*)(void *, void *))objc_msgSend)(app, sel_registerName("updateWindows"));
		return 1;
	}
	return CFRunLoopRunInMode(mode, 0.002, 0);
}

// --- file panels (NSOpenPanel, NSSavePanel) --------------------------------
//
// No object of any kind crosses bun:ffi here. A file path is routinely short
// ASCII, and a short ASCII NSString is a tagged pointer above 2^53, so the
// panel's URLs are decoded and copied into C-side storage and JS reads an int
// status plus a copied `const char *`. See the traps in DESIGN.md §2.
//
// The open and save panels share every piece of that machinery: the same
// status set, the same static path storage, the same hand-built completion
// block, and the same poll. They differ only in the class they build, the
// setters they accept, and the read that collects the answer (`-URLs` for the
// open panel, `-URL` for the save panel).
//
// Status codes, mirrored by PANEL_STATUS in index.ts:
#define SHIM_PANEL_PICKED 0        // modal pick finished with >= 1 path
#define SHIM_PANEL_CANCELLED 1     // modal pick finished with no path
#define SHIM_PANEL_UNSUPPORTED 2   // NSOpenPanel, or a selector it needs, is absent
#define SHIM_PANEL_SHEET_STARTED 3 // beginSheet... accepted; poll shim_sheet_done()
#define SHIM_PANEL_NO_WINDOW 4     // sheet asked for with no key window
#define SHIM_PANEL_BUSY 5          // a sheet is already up; nothing was sent, nothing was touched

#define SHIM_PANEL_MAX_PATHS 32
#define SHIM_PANEL_PATH_BYTES 4096

static char panel_paths[SHIM_PANEL_MAX_PATHS][SHIM_PANEL_PATH_BYTES];
static int panel_paths_used;

// The sheet's answer, written by the completion handler and read from JS by
// polling: a blocking -runModal stops the JavaScript thread and with it every
// in-flight invoke, while a sheet plus a done flag leaves both running.
//
// SHIM_PANEL_NO_RESPONSE is the "not answered yet" value, chosen because it is
// neither NSModalResponseOK (1) nor NSModalResponseCancel (0).
#define SHIM_PANEL_NO_RESPONSE -1

static obj_t panel_sheet_panel; // live panel while its sheet is up, else 0
static int panel_sheet_is_save; // which class the live sheet is, for collection
static volatile int panel_sheet_done;
static volatile long long panel_sheet_response = SHIM_PANEL_NO_RESPONSE;

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

// The shared storage above is taken over by a request that is actually going to
// use it, never on entry: resetting first would clear a live sheet's pointer and
// done flag, which is exactly how a second request used to wipe the first one's
// answer. Every call site below sits next to the send it prepares, after every
// guard that can refuse the request has already answered.
static void panel_reset(void) {
	panel_paths_used = 0;
	panel_paths[0][0] = 0;
	panel_sheet_panel = 0;
	panel_sheet_is_save = 0;
	panel_sheet_done = 0;
	panel_sheet_response = SHIM_PANEL_NO_RESPONSE;
}

// One sheet at a time, and this is the whole reason a second request is
// refused instead of started: the storage above holds exactly one panel, one
// done flag and one path list, so starting a second sheet would overwrite the
// first one's state and a page already awaiting the first pick would read the
// second panel's answer. A request that lands while a sheet is up therefore
// answers SHIM_PANEL_BUSY before anything is touched, which leaves the live
// sheet — pointer, done flag and paths — exactly as it was. `dialog.cancel` in
// the plugin is how a page gets out of a sheet it no longer wants.
static int panel_sheet_busy(void) { return panel_sheet_panel != 0 && !panel_sheet_done; }

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

// -[NSSavePanel URL] -> -path -> -UTF8String. A save panel names exactly one
// file and has no -URLs, so this is the whole collection.
static void panel_collect_save(obj_t panel) {
	obj_t url = ((obj_t (*)(void *, void *))objc_msgSend)(panel, sel_registerName("URL"));
	if (!url) return;
	obj_t path = ((obj_t (*)(void *, void *))objc_msgSend)(url, sel_registerName("path"));
	if (!path) return;
	const char *utf8 = ((const char *(*)(void *, void *))objc_msgSend)(
	    path, sel_registerName("UTF8String"));
	panel_copy_path(utf8);
}

// A comma-separated extension list into -setAllowedFileTypes:. A JS array
// cannot cross the boundary, so the list arrives as one C string. A missing
// selector, a null array or a failed string leaves the panel unfiltered rather
// than aborting the pick. The setter is deprecated on macOS 27 but present on
// both panel classes; `allowedContentTypes` would be a UTType object graph.
static void panel_set_file_types(const char *clsname, obj_t panel, const char *types) {
	if (!types || !types[0]) return;
	if (!panel_has_instance(clsname, "setAllowedFileTypes:")) return;
	obj_t cls = objc_getClass("NSMutableArray");
	if (!cls) return;
	obj_t array = ((obj_t (*)(void *, void *))objc_msgSend)(cls, sel_registerName("array"));
	if (!array) return;

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

// --- sheet completion: a hand-built global block ---------------------------
//
// `beginSheetModalForWindow:completionHandler:` takes a block, and a sheet
// started with a NULL one can only ever be started — which is exactly what this
// path did until now. A block is plain memory:
//
//   { isa, flags, reserved, invoke, descriptor }
//
// A GLOBAL block (isa `__NSGlobalBlock__`, BLOCK_IS_GLOBAL set) needs no copy or
// dispose helper and no heap, which is what makes it constructible from C with
// no compiler support; `Block_copy` on it is a documented no-op, so a static
// instance outlives the call that hands it to AppKit. `notifications.c` builds
// its two handlers the same way and they are measured working.
//
// Bit 28 is BLOCK_IS_GLOBAL. Bit 30 is BLOCK_HAS_SIGNATURE, and setting that
// without a real signature in the descriptor makes the runtime read past this
// hand-built struct — so it is deliberately never set. The isa comes from
// objc_getClass rather than the `_NSConcreteGlobalBlock` data symbol, so a
// missing symbol cannot break linking.
#define SHIM_BLOCK_IS_GLOBAL (1 << 28)

typedef struct {
	unsigned long reserved;
	unsigned long size;
} shim_block_descriptor;

// (^)(NSModalResponse response) — NSInteger, so long long on arm64. The block
// itself is the hidden first argument, exactly as the runtime sends it.
typedef struct {
	void *isa;
	int flags;
	int reserved;
	void (*invoke)(void *, long long);
	void *descriptor;
} shim_sheet_block_t;

static shim_block_descriptor panel_sheet_desc;
static shim_sheet_block_t panel_sheet_block;
static int panel_sheet_block_ready;

static void panel_sheet_invoke(void *block, long long response);

static int panel_sheet_block_init(void) {
	if (panel_sheet_block_ready) return 1;
	obj_t isa = objc_getClass("__NSGlobalBlock__");
	if (!isa) return 0;
	panel_sheet_desc.reserved = 0;
	panel_sheet_desc.size = sizeof(shim_sheet_block_t);
	panel_sheet_block.isa = isa;
	panel_sheet_block.flags = SHIM_BLOCK_IS_GLOBAL;
	panel_sheet_block.reserved = 0;
	panel_sheet_block.invoke = panel_sheet_invoke;
	panel_sheet_block.descriptor = &panel_sheet_desc;
	panel_sheet_block_ready = 1;
	return 1;
}

// Runs on the main thread when the sheet ends, by either route: the user's
// click, or the -cancel: shim_sheet_cancel() sends. Recording the response
// first and the done flag last is what makes a JS read after `done` always see
// the response and the paths together. NSModalResponseOK is 1, and the live
// panel's class decides which read collects the answer.
static void panel_sheet_invoke(void *block, long long response) {
	(void)block;
	panel_sheet_response = response;
	if (response == 1 && panel_sheet_panel) {
		if (panel_sheet_is_save) panel_collect_save(panel_sheet_panel);
		else panel_collect(panel_sheet_panel);
	}
	panel_sheet_done = 1;
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

// The window a sheet attaches to, for either panel class. Returns 0 when this
// process has no window at all, which is what keeps -runModal the fallback.
static int panel_sheet_target(obj_t *out) {
	obj_t app = 0;
	if (shim_responds((obj_t)objc_getClass("NSApplication"),
	                  sel_registerName("sharedApplication"))) {
		app = ((obj_t (*)(void *, void *))objc_msgSend)(objc_getClass("NSApplication"),
		                                               sel_registerName("sharedApplication"));
	}
	if (!app) return 0;
	*out = panel_sheet_window(app);
	return *out ? 1 : 0;
}

// Opens an NSOpenPanel.
//
//   runModal = 1  calls -runModal and BLOCKS this thread until the user answers.
//                 Called from JS that stops the JavaScript thread and the Cocoa
//                 pump for the duration; accepted for a file picker, and stated
//                 as blocking rather than dressed up as async.
//   runModal = 0  calls -beginSheetModalForWindow:completionHandler: with a real
//                 completion handler and returns at once, status
//                 SHIM_PANEL_SHEET_STARTED. The handler records the
//                 NSModalResponse, copies -URLs, and sets the done flag, so the
//                 caller polls shim_sheet_done() while the pump and the bridge
//                 keep running. With no key window there is nothing to attach a
//                 sheet to and this returns SHIM_PANEL_NO_WINDOW without
//                 sending, which is what keeps the blocking path a fallback.
int shim_open_panel(const char *title, const char *types, int allowDirectories, int allowMultiple,
                    int runModal) {
	// A request that cannot be honoured leaves the live sheet untouched. This
	// checked nothing until now, and resetting first meant a second request
	// wiped the first one's panel pointer, done flag and path storage.
	if (panel_sheet_busy()) return SHIM_PANEL_BUSY;

	// The panel class and its factory must exist before anything is built.
	if (!objc_getClass("NSOpenPanel")) return SHIM_PANEL_UNSUPPORTED;
	if (!shim_responds((obj_t)objc_getClass("NSOpenPanel"),
	                   sel_registerName("openPanel")))
		return SHIM_PANEL_UNSUPPORTED;

	// A sheet needs a window first: sending beginSheet… with a nil window is an
	// AppKit exception, and an exception here is a crashed process.
	obj_t sheet_window = 0;
	if (!runModal) {
		if (!panel_has_instance("NSOpenPanel", "beginSheetModalForWindow:completionHandler:"))
			return SHIM_PANEL_UNSUPPORTED;
		if (!panel_sheet_target(&sheet_window)) return SHIM_PANEL_NO_WINDOW;
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
	// boundary. A missing selector leaves the panel unfiltered rather than
	// aborting the pick.
	panel_set_file_types("NSOpenPanel", panel, types);

	if (!runModal) {
		if (!panel_sheet_block_init()) return SHIM_PANEL_UNSUPPORTED;
		// Take over the shared storage only now: the live panel has to be set
		// before the send, because the handler reads it to collect -URLs and a
		// sheet that ends immediately must still find it.
		panel_reset();
		panel_sheet_panel = panel;
		panel_sheet_done = 0;
		panel_sheet_response = SHIM_PANEL_NO_RESPONSE;
		((void (*)(void *, void *, obj_t, obj_t))objc_msgSend)(
		    panel, sel_registerName("beginSheetModalForWindow:completionHandler:"), sheet_window,
		    (obj_t)&panel_sheet_block);
		return SHIM_PANEL_SHEET_STARTED;
	}

	if (!panel_sheet_block_init()) return SHIM_PANEL_UNSUPPORTED;
	// No window to attach a sheet to, so present the panel on its own. `-runModal`
	// would block this thread until a human answers, and a windowless app would
	// then have no way out at all: nothing else can run, so `dialog.cancel` never
	// gets the chance to fire. `-beginWithCompletionHandler:` presents the same
	// panel, returns at once and reports through the same completion block, so the
	// poll and the cancel below work here unchanged (measured 2026-11-14).
	if (!panel_has_instance("NSOpenPanel", "beginWithCompletionHandler:"))
		return SHIM_PANEL_UNSUPPORTED;
	panel_reset();
	panel_sheet_panel = panel;
	panel_sheet_is_save = 0;
	panel_sheet_done = 0;
	panel_sheet_response = SHIM_PANEL_NO_RESPONSE;
	((void (*)(void *, void *, obj_t))objc_msgSend)(
	    panel, sel_registerName("beginWithCompletionHandler:"), (obj_t)&panel_sheet_block);
	return SHIM_PANEL_SHEET_STARTED;
}

int shim_open_panel_count(void) { return panel_paths_used; }

// The path at `index`, or "" out of range. Static storage: valid until the next
// shim_open_panel or shim_save_panel call, which is all a caller needs.
const char *shim_open_panel_path(int index) {
	if (index < 0 || index >= panel_paths_used) return "";
	return panel_paths[index];
}

// Opens an NSSavePanel. Same two modes, same statuses, same storage as
// shim_open_panel; the caller supplies a suggested file name and an allowed
// extension list instead of a selection shape.
//
// Overwrite confirmation is AppKit's own job: NSSavePanel asks before replacing
// an existing file, and nothing here suppresses that prompt or adds a second
// confirmation of ours. crust never writes the file — the caller does, after
// the panel answers.
int shim_save_panel(const char *title, const char *suggested_name, const char *types,
                    int runModal) {
	// Same one-sheet rule as shim_open_panel: refusing before any state changes
	// is what keeps a pending open panel's answer readable.
	if (panel_sheet_busy()) return SHIM_PANEL_BUSY;

	if (!objc_getClass("NSSavePanel")) return SHIM_PANEL_UNSUPPORTED;
	if (!shim_responds((obj_t)objc_getClass("NSSavePanel"), sel_registerName("savePanel")))
		return SHIM_PANEL_UNSUPPORTED;

	obj_t sheet_window = 0;
	if (!runModal) {
		if (!panel_has_instance("NSSavePanel", "beginSheetModalForWindow:completionHandler:"))
			return SHIM_PANEL_UNSUPPORTED;
		if (!panel_sheet_target(&sheet_window)) return SHIM_PANEL_NO_WINDOW;
	}

	obj_t panel = ((obj_t (*)(void *, void *))objc_msgSend)(objc_getClass("NSSavePanel"),
	                                                        sel_registerName("savePanel"));
	if (!panel) return SHIM_PANEL_UNSUPPORTED;

	if (title && title[0] && panel_has_instance("NSSavePanel", "setTitle:")) {
		obj_t t = panel_nsstring(title);
		if (t) ((void (*)(void *, void *, obj_t))objc_msgSend)(panel, sel_registerName("setTitle:"), t);
	}

	// The name field's starting value. It is a bare file name; the panel still
	// lets the user change it, and a missing selector just leaves it blank.
	if (suggested_name && suggested_name[0] &&
	    panel_has_instance("NSSavePanel", "setNameFieldStringValue:")) {
		obj_t n = panel_nsstring(suggested_name);
		if (n)
			((void (*)(void *, void *, obj_t))objc_msgSend)(
			    panel, sel_registerName("setNameFieldStringValue:"), n);
	}

	panel_set_file_types("NSSavePanel", panel, types);

	if (!runModal) {
		if (!panel_sheet_block_init()) return SHIM_PANEL_UNSUPPORTED;
		panel_reset();
		panel_sheet_panel = panel;
		panel_sheet_is_save = 1;
		panel_sheet_done = 0;
		panel_sheet_response = SHIM_PANEL_NO_RESPONSE;
		((void (*)(void *, void *, obj_t, obj_t))objc_msgSend)(
		    panel, sel_registerName("beginSheetModalForWindow:completionHandler:"), sheet_window,
		    (obj_t)&panel_sheet_block);
		return SHIM_PANEL_SHEET_STARTED;
	}

	if (!panel_sheet_block_init()) return SHIM_PANEL_UNSUPPORTED;
	// Same reason as the open panel below-free-standing case: a windowless save
	// panel must not block the thread, or the app can never cancel it.
	if (!panel_has_instance("NSSavePanel", "beginWithCompletionHandler:"))
		return SHIM_PANEL_UNSUPPORTED;
	panel_reset();
	panel_sheet_panel = panel;
	panel_sheet_is_save = 1;
	panel_sheet_done = 0;
	panel_sheet_response = SHIM_PANEL_NO_RESPONSE;
	((void (*)(void *, void *, obj_t))objc_msgSend)(
	    panel, sel_registerName("beginWithCompletionHandler:"), (obj_t)&panel_sheet_block);
	return SHIM_PANEL_SHEET_STARTED;
}

// --- sheet result, for a caller that polls instead of blocking --------------

// 1 once the sheet started by shim_open_panel(…, 0) or shim_save_panel(…, 0) has
// ended, 0 while it is up (and 0 before any sheet). Answering this is the whole
// reason the sheet path no longer needs a human: the promise settles on the
// frame after the click.
int shim_sheet_done(void) { return panel_sheet_done; }

// The NSModalResponse the sheet ended with: 1 is NSModalResponseOK and 0 is a
// cancel. SHIM_PANEL_NO_RESPONSE (-1) means it has not ended yet, so a caller
// that reads 0 can never confuse "cancel" with "no answer".
long long shim_sheet_response(void) { return panel_sheet_response; }

// End the live sheet without a human: -cancel: is the panel's own cancel
// action, so it runs the same path as clicking Cancel — the completion handler
// fires, the response is recorded, and the sheet leaves the window. Returns 1
// when the send happened, 0 when no sheet is up (or it had already answered) or
// the selector is absent, so a page that calls it twice cannot end a second
// sheet by accident.
//
// This is the page-level cancel behind the plugin's `dialog.cancel`, and it is
// also how a page gets out of a sheet it opened without meaning to: the release
// is the completion handler's, so the state a later request resets is already
// the one a user's click would have left.
int shim_sheet_cancel(void) {
	obj_t panel = panel_sheet_panel;
	if (!panel || panel_sheet_done) return 0;
	const char *clsname = panel_sheet_is_save ? "NSSavePanel" : "NSOpenPanel";
	if (!panel_has_instance(clsname, "cancel:")) return 0;
	((void (*)(void *, void *))objc_msgSend)(panel, sel_registerName("cancel:"));
	return 1;
}

// Which class the live sheet is, so a refusal can name the panel that is
// already up instead of saying "busy": 1 for NSOpenPanel, 2 for NSSavePanel, 0
// when no sheet is waiting for an answer. A finished sheet is not blocking
// anybody, so it reads 0 — the same rule panel_sheet_busy() applies.
int shim_sheet_kind(void) {
	if (!panel_sheet_busy()) return 0;
	return panel_sheet_is_save ? 2 : 1;
}
