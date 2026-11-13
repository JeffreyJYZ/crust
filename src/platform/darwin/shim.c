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
