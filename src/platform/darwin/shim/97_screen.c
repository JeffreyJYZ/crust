// Screen geometry, for the positioner and the screen plugin.
//
// NSScreen is read on the main queue because AppKit may touch window-server state, and an
// NSRect is 32 bytes, which arm64 returns indirectly — so each call goes through a function
// pointer whose prototype returns the struct and lets the compiler emit the ABI.
//
// `[NSScreen screens]` is an autoreleased NSArray, so it is fetched per call and never stored:
// a display plugged in or removed between two calls must be visible, and a retained object
// across a display change is the stale answer this replaces.

typedef struct {
	double x;
	double y;
	double width;
	double height;
} crust_rect;

extern void *objc_getClass(const char *name);
extern void *sel_registerName(const char *name);
extern void *objc_msgSend(void);

// [obj respondsToSelector:sel] — the only existence test that is safe on an instance, and an
// uncaught ObjC exception kills the process with no JavaScript error.
static int crust_scr_has(void *obj, const char *selname) {
	if (!obj) return 0;
	return (int)(char)((char (*)(void *, void *, void *))objc_msgSend)(
	    obj, sel_registerName("respondsToSelector:"), sel_registerName(selname));
}

// `[NSScreen screens]`, or 0 when the class or the class method is gone.
static void *crust_screens(void) {
	void *cls = objc_getClass("NSScreen");
	if (!crust_scr_has(cls, "screens")) return 0;
	return ((void *(*)(void *, void *))objc_msgSend)(cls, sel_registerName("screens"));
}

// One NSScreen by index, or 0 when the index is past the end.
static void *crust_screen_at(void *screens, int index) {
	if (!screens || index < 0) return 0;
	unsigned long count = ((unsigned long (*)(void *, void *))objc_msgSend)(
	    screens, sel_registerName("count"));
	if ((unsigned long)index >= count) return 0;
	return ((void *(*)(void *, void *, unsigned long))objc_msgSend)(
	    screens, sel_registerName("objectAtIndex:"), (unsigned long)index);
}

static crust_rect crust_read_nsrect(void *screen, const char *selname) {
	crust_rect empty = {0, 0, 0, 0};
	if (!crust_scr_has(screen, selname)) return empty;
	return ((crust_rect(*)(void *, void *))objc_msgSend)(screen, sel_registerName(selname));
}

// Writes x, y, width and height into `out` (four doubles). 1 when a screen answered, 0 otherwise.
// Called from the bridge, which crust pumps on the main thread, so no dispatch hop is needed —
// and TinyCC cannot compile a block, while `dispatch_get_main_queue` is not resolvable from it.
int shim_screen_visible_frame(double *out) {
	if (out == 0) return 0;
	void *screen = crust_screen_at(crust_screens(), 0);
	if (screen == 0) {
		void *cls = objc_getClass("NSScreen");
		if (!crust_scr_has(cls, "mainScreen")) return 0;
		screen = ((void *(*)(void *, void *))objc_msgSend)(cls, sel_registerName("mainScreen"));
	}
	if (screen == 0) return 0;
	crust_rect frame = crust_read_nsrect(screen, "visibleFrame");
	out[0] = frame.x;
	out[1] = frame.y;
	out[2] = frame.width;
	out[3] = frame.height;
	return 1;
}

// How many displays AppKit lists. 0 is the honest answer for a headless process.
int shim_screen_count(void) {
	void *screens = crust_screens();
	if (!screens) return 0;
	return (int)((unsigned long (*)(void *, void *))objc_msgSend)(screens,
	                                                             sel_registerName("count"));
}

// Ten doubles for one display, in AppKit's own coordinates: frame x/y/w/h, visibleFrame
// x/y/w/h, backingScaleFactor, then 1 when this is `[NSScreen screens][0]` — the primary, which
// is the display whose origin AppKit treats as (0,0). 1 written, 0 when the index names nothing.
int shim_screen_info(int index, double *out) {
	if (out == 0) return 0;
	void *screen = crust_screen_at(crust_screens(), index);
	if (screen == 0) return 0;
	crust_rect frame = crust_read_nsrect(screen, "frame");
	crust_rect visible = crust_read_nsrect(screen, "visibleFrame");
	double scale = 1.0;
	if (crust_scr_has(screen, "backingScaleFactor")) {
		scale = ((double (*)(void *, void *))objc_msgSend)(screen,
		                                                  sel_registerName("backingScaleFactor"));
	}
	out[0] = frame.x;
	out[1] = frame.y;
	out[2] = frame.width;
	out[3] = frame.height;
	out[4] = visible.x;
	out[5] = visible.y;
	out[6] = visible.width;
	out[7] = visible.height;
	out[8] = scale > 0 ? scale : 1.0;
	out[9] = index == 0 ? 1.0 : 0.0;
	return 1;
}
