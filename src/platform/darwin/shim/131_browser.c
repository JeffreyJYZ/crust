// --- browser: the embedded surface's view and its shared C helpers -----------
// First of two parts (`132_browser_ui.c` is joined after it by
// `platform/darwin/browser-unit.ts` into one translation unit). Compiled with `cc()` and AppKit,
// Foundation and WebKit linked by name, never by the window shim.
//
// The shim's four rules hold: one fixed prototype per objc_msgSend, no framework header, no object
// and no struct across bun:ffi, and every string arrives as bytes and becomes an NSString here.
// The surface is an NSView host over the app's page; WebKit's own frame is set from C because a
// CGRect cannot cross the FFI boundary.

typedef void *br_t;

extern br_t objc_msgSend(void *self, void *sel, ...);
extern br_t objc_getClass(const char *name);
extern br_t sel_registerName(const char *name);

// A rectangle, built on the C stack: a struct never crosses bun:ffi.
typedef struct {
	double x, y, w, h;
} br_rect;

static br_t br_msg0(br_t obj, const char *sel) {
	return ((br_t(*)(void *, void *))objc_msgSend)(obj, sel_registerName(sel));
}

// [obj respondsToSelector:sel] — the only existence test that is safe on an instance, and every
// send in this unit is guarded, because an uncaught ObjC exception terminates the process.
static int br_has(br_t obj, const char *name) {
	if (!obj) return 0;
	return (int)(char)((char (*)(void *, void *, void *))objc_msgSend)(
	    obj, sel_registerName("respondsToSelector:"), sel_registerName(name));
}

// An NSString's UTF-8 bytes into `dst`, truncated to the buffer. Returns the copied length.
static long long br_copy(br_t text, char *dst, long long cap) {
	if (!text || !dst || cap <= 0) return 0;
	if (!br_has(text, "UTF8String")) return 0;
	const char *bytes =
	    ((const char *(*)(void *, void *))objc_msgSend)(text, sel_registerName("UTF8String"));
	if (!bytes) return 0;
	long long length = 0;
	while (bytes[length]) length++;
	long long copied = length < cap - 1 ? length : cap - 1;
	for (long long i = 0; i < copied; i++) dst[i] = bytes[i];
	dst[copied] = 0;
	return copied;
}

// `[[NSView alloc] initWithFrame:CGRectZero]`: the frame arrives from `set_frame` in this unit.
br_t shim_browser_view_new(void) {
	br_t cls = objc_getClass("NSView");
	if (!cls) return 0;
	br_t allocd = br_msg0(cls, "alloc");
	if (!allocd) return 0;
	br_rect frame = {0, 0, 0, 0};
	return ((br_t(*)(void *, void *, br_rect))objc_msgSend)(
	    allocd, sel_registerName("initWithFrame:"), frame);
}

void shim_browser_view_set_frame(br_t view, double x, double y, double w, double h) {
	if (!view) return;
	br_rect frame = {x, y, w < 0 ? 0 : w, h < 0 ? 0 : h};
	((void (*)(void *, void *, br_rect))objc_msgSend)(view, sel_registerName("setFrame:"), frame);
}

// NSWindowAbove (1) with no relative sibling: the surface sits over the app's own webview.
int shim_browser_attach(br_t parent, br_t view) {
	if (!parent || !view) return 0;
	((void (*)(void *, void *, br_t, long long, br_t))objc_msgSend)(
	    parent, sel_registerName("addSubview:positioned:relativeTo:"), view, 1LL, (br_t)0);
	return 1;
}

void shim_browser_detach(br_t view) {
	if (!view) return;
	((void (*)(void *, void *))objc_msgSend)(view, sel_registerName("removeFromSuperview"));
}

// `-initWithFrame:` returned +1; detaching only drops the superview's retain, so the caller must
// send this once per surface after the detach sends or every open/close cycle leaks one NSView.
void shim_browser_view_release(br_t view) {
	if (!view) return;
	((void (*)(void *, void *))objc_msgSend)(view, sel_registerName("release"));
}
