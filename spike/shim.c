// crust M0 shim — compiled at launch by bun:ffi's cc().
//
// Rules this file obeys, each one measured (research/cc.md, research/objc.md):
//
//  1. EVERY objc_msgSend call site casts to a FIXED prototype. A plain
//     `extern void *objc_msgSend(void *, void *, ...)` compiles and runs, and
//     delivers wrong argument values with no diagnostic (41 arrived as
//     1806466472). Zero-argument sends happen to survive; nothing else does.
//  2. No framework headers. <AppKit/AppKit.h> and <Foundation/Foundation.h> are
//     unreachable from TCC with or without -I/-F, so every symbol is a
//     hand-written extern over void *.
//  3. No struct crosses the export boundary. CGRect is only ever built and read
//     inside this file; JS sees scalars and pointers.
//  4. No `stringWithUTF8:` — it aborts the process when handed a buffer
//     (research/runloop/runloop.md, abort table). +[NSData dataWithBytes:length:]
//     then -[NSString initWithData:encoding:] is the measured working path.

typedef void *obj_t;

extern obj_t objc_msgSend(void *self, void *sel, ...);
extern obj_t objc_getClass(const char *name);
extern obj_t sel_registerName(const char *name);
extern void *class_getInstanceMethod(void *cls, void *sel);
extern void *class_getClassMethod(void *cls, void *sel);
extern void *object_getClass(void *obj);
extern const char *class_getName(void *cls);
extern int NSApplicationLoad(void);
extern int CFRunLoopRunInMode(void *mode, double seconds, int returnAfterSourceHandled);
extern obj_t __CFStringMakeConstantString(const char *cstr);
extern obj_t CFStringCreateWithCString(void *alloc, const char *cstr, unsigned int encoding);
extern int CFStringGetCString(void *s, char *buf, long size, unsigned int encoding);
extern long CFStringGetLength(void *s);

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
void *shim_class_method(void *cls, obj_t sel) { return class_getClassMethod(cls, sel); }

// [obj respondsToSelector:sel] — the only existence test that is safe on an
// instance, and the honest one on a class object (class_getClassMethod reports
// +init/+valueForKey: as present on every class through the metaclass chain).
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

// long long / unsigned long long returns (styleMask, activationPolicy).
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

// --- strings, URLs, requests ----------------------------------------------

// +[NSData dataWithBytes:length:] then -[NSString initWithData:encoding:].
// Split into two exports so the probe can tell which half fails.
long long shim_cstr_len(const char *p) {
	long long n = 0;
	while (p[n]) n++;
	return n;
}

obj_t shim_data(const void *bytes, long long n) {
	return ((obj_t (*)(void *, void *, const void *, long long))objc_msgSend)(
	    objc_getClass("NSData"), sel_registerName("dataWithBytes:length:"), bytes, n);
}

obj_t shim_nsstring_from_data(obj_t data) {
	obj_t strCls = objc_getClass("NSString");
	if (!strCls || !data) return 0;
	return ((obj_t (*)(void *, void *, void *, long long))objc_msgSend)(
	    ((obj_t (*)(void *, void *))objc_msgSend)(strCls, sel_registerName("alloc")),
	    sel_registerName("initWithData:encoding:"), data, 4LL /* NSUTF8StringEncoding */);
}

// FAILED CONSTRUCTS, kept out of this file on purpose:
//
//  * one C function that built an NSData and then the NSString (nested sends,
//    and again with the two steps composed as statements): both crashed.
//  * Any NSString allocation path from C. `+[NSString stringWithUTF8String:]`
//    aborts the process, and a C-side NSData -> NSString round trip raised an
//    unrecognised-selector exception (SIGABRT) instead of returning.
//
// What works, and what is used instead: build a CFString. It is toll-free
// bridged to NSString, needs no allocation object beyond the allocator
// argument, and its length can be verified with CFStringGetLength without ever
// sending a selector to the result.
obj_t shim_cfstring(const char *utf8) {
	return CFStringCreateWithCString((void *)0, utf8, 0x08000100 /* kCFStringEncodingUTF8 */);
}

long long shim_cfstring_length(obj_t s) { return s ? CFStringGetLength(s) : -1; }

// Length of an NSString, so a string round-trip can be verified without
// -UTF8String (which returns a char * and therefore arrives as a JS string).
long long shim_length(obj_t nsstr) {
	if (!nsstr) return -1;
	return ((long long (*)(void *, void *))objc_msgSend)(nsstr, sel_registerName("length"));
}

// The string's contents as a C string. bun:ffi decodes a `cstring` return into
// a JS string, so this is the read path for anything the page or AppKit wrote.
const char *shim_utf8(obj_t nsstr) {
	if (!nsstr) return "";
	return ((const char *(*)(void *, void *))objc_msgSend)(nsstr, sel_registerName("UTF8String"));
}

obj_t shim_url_with_string(obj_t nsstr) {
	return ((obj_t (*)(void *, void *, void *))objc_msgSend)(
	    objc_getClass("NSURL"), sel_registerName("URLWithString:"), nsstr);
}

obj_t shim_request_with_url(obj_t url) {
	return ((obj_t (*)(void *, void *, void *))objc_msgSend)(
	    objc_getClass("NSURLRequest"), sel_registerName("requestWithURL:"), url);
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

// --- struct-valued operations kept entirely inside C ----------------------

// -[NSView valueForKey:](@"frame") returns an NSValue; -getValue: fills a
// CGRect. Both stay on the C stack: no struct crosses bun:ffi, and no out
// pointer is handed across it either (a JS buffer's address is not what a
// native ptr parameter receives — objc.md §4). Callers ask for one component
// at a time: 0 = x, 1 = y, 2 = width, 3 = height.
// A C string into an NSString, for selectors that take a string object. Fixed
// prototype: a variadic declaration here would silently pass garbage.
obj_t shim_string(const char *s) {
	return ((obj_t (*)(void *, void *, const char *))objc_msgSend)(
	    objc_getClass("NSString"), sel_registerName("stringWithUTF8String:"), s);
}

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

// --- string intern --------------------------------------------------------
// A short ASCII NSString is a tagged pointer, which cannot survive the trip
// through a JS number, so the object stays here and JS holds an index. Encoding
// 4 is NSUTF8StringEncoding.

#define SHIM_INTERN_MAX 128
static obj_t g_intern[SHIM_INTERN_MAX];
static int g_intern_n;

int shim_intern_bytes(const void *bytes, unsigned long len, long long encoding) {
	if (g_intern_n >= SHIM_INTERN_MAX) return -1;
	obj_t data = ((obj_t (*)(void *, void *, const void *, unsigned long))objc_msgSend)(
	    objc_getClass("NSData"), sel_registerName("dataWithBytes:length:"), bytes, len);
	if (!data) return -1;
	obj_t allocd = ((obj_t (*)(void *, void *))objc_msgSend)(
	    objc_getClass("NSString"), sel_registerName("alloc"));
	if (!allocd) return -1;
	obj_t s = ((obj_t (*)(void *, void *, obj_t, long long))objc_msgSend)(
	    allocd, sel_registerName("initWithData:encoding:"), data, encoding);
	if (!s) return -1;
	g_intern[g_intern_n] = s;
	return g_intern_n++;
}

long long shim_intern_len(int i) {
	if (i < 0 || i >= g_intern_n) return -1;
	return ((long long (*)(void *, void *))objc_msgSend)(g_intern[i], sel_registerName("length"));
}

const char *shim_intern_utf8(int i) {
	if (i < 0 || i >= g_intern_n) return "";
	return ((const char *(*)(void *, void *))objc_msgSend)(g_intern[i],
	                                                     sel_registerName("UTF8String"));
}

// Loads a URL in a webview entirely inside C, so no object-valued argument
// ever crosses bun:ffi — a short ASCII NSString is a tagged pointer and cannot
// survive the trip. Returns 1 on success, 0 if any step returned null.
int shim_webview_load(obj_t web, const char *url) {
	obj_t allocd = ((obj_t (*)(void *, void *))objc_msgSend)(objc_getClass("NSString"),
	                                                        sel_registerName("alloc"));
	if (!allocd) return 0;
	obj_t nsstr = ((obj_t (*)(void *, void *, const char *, unsigned long,
	                          long long))objc_msgSend)(
	    allocd, sel_registerName("initWithBytes:length:encoding:"), url, shim_cstr_len(url), 4LL);
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
// 4 ms delivered only 82.4% of a 16 ms tick (research/runloop/runloop.md).
int shim_pump(obj_t mode) { return CFRunLoopRunInMode(mode, 0.00025, 1); }
