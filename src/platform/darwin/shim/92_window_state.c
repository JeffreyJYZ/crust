// --- window state ---------------------------------------------------------
// Geometry, level and the window-level toggles behind `window.setSize` and
// friends. Every selector here is an NSWindow method present since 10.7, so a
// null check is the whole guard: a missing one is caught by PREFLIGHT by name
// before `start()` returns. `shim_rect` is 40_window.c's typedef, in scope
// because the shim is one compilation unit, so no struct ever crosses bun:ffi.

// `display: 1` redraws during the change; without it a resize leaves stale
// pixels until the next event, which reads as a rendering bug.
void shim_window_set_frame(obj_t win, double x, double y, double w, double h) {
	if (!win) return;
	shim_rect r = {x, y, w, h};
	((void (*)(void *, void *, shim_rect, int))objc_msgSend)(
	    win, sel_registerName("setFrame:display:"), r, 1);
}

// -frame returns an NSRect, and a struct return needs a struct prototype that
// bun:ffi has no type for, so it is read here one component at a time:
// 0 = x, 1 = y, 2 = width, 3 = height. NaN for a null window or a bad index.
double shim_window_frame_num(obj_t win, int component) {
	double nan = 0.0 / 0.0;
	if (!win) return nan;
	shim_rect r = ((shim_rect (*)(void *, void *))objc_msgSend)(win, sel_registerName("frame"));
	if (component == 0) return r.x;
	if (component == 1) return r.y;
	if (component == 2) return r.w;
	if (component == 3) return r.h;
	return nan;
}

// NSFloatingWindowLevel is 3 and NSNormalWindowLevel is 0; JS maps the flag to
// those two and reads the level back, so "on top" stays a measurement.
void shim_window_set_level(obj_t win, long long level) {
	if (!win) return;
	((void (*)(void *, void *, long long))objc_msgSend)(win, sel_registerName("setLevel:"),
	                                                   level);
}

long long shim_window_level(obj_t win) {
	if (!win) return 0;
	return ((long long (*)(void *, void *))objc_msgSend)(win, sel_registerName("level"));
}

// -toggleFullScreen: is a flip, not a setter: sending it twice returns to where
// it started, so the caller compares this read first. -isFullScreen does not
// resolve on macOS 27 (measured 2026-11-15), so the state is styleMask's bit 14,
// NSWindowStyleMaskFullScreen. The transition is animated, hence the mask.
int shim_window_is_fullscreen(obj_t win) {
	if (!win) return 0;
	long long mask =
	    ((long long (*)(void *, void *))objc_msgSend)(win, sel_registerName("styleMask"));
	return (mask & (1LL << 14)) ? 1 : 0;
}

void shim_window_toggle_fullscreen(obj_t win) {
	if (!win) return;
	((void (*)(void *, void *))objc_msgSend)(win, sel_registerName("toggleFullScreen:"));
}

// -zoom: is the green button: it maximises to the screen's visible frame, and a
// second call returns the window to its previous size. -isZoomed reports which.
int shim_window_is_zoomed(obj_t win) {
	if (!win) return 0;
	return (int)(char)((char (*)(void *, void *))objc_msgSend)(win, sel_registerName("isZoomed"));
}

void shim_window_zoom(obj_t win) {
	if (!win) return;
	((void (*)(void *, void *))objc_msgSend)(win, sel_registerName("zoom:"));
}

void shim_window_miniaturize(obj_t win) {
	if (!win) return;
	((void (*)(void *, void *))objc_msgSend)(win, sel_registerName("miniaturize:"));
}

void shim_window_deminiaturize(obj_t win) {
	if (!win) return;
	((void (*)(void *, void *))objc_msgSend)(win, sel_registerName("deminiaturize:"));
}
