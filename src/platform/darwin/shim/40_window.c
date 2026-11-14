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

