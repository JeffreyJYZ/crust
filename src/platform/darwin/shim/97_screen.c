// Visible frame of the main screen, for the positioner plugin.
//
// NSScreen is read on the main queue because AppKit may touch window-server state, and the
// returned NSRect is 32 bytes, which arm64 returns indirectly — so the call goes through a
// function pointer whose prototype returns the struct and lets the compiler emit the ABI.

typedef struct {
	double x;
	double y;
	double width;
	double height;
} crust_rect;

extern void *objc_getClass(const char *name);
extern void *sel_registerName(const char *name);
extern void *objc_msgSend(void);

static crust_rect crust_frame;
static int crust_frame_ok = 0;

static void crust_read_frame(void) {
	void *screen_class = objc_getClass("NSScreen");
	if (screen_class == 0) return;
	void *(*main_screen)(void *, void *) = (void *(*)(void *, void *))objc_msgSend;
	void *screen = main_screen(screen_class, sel_registerName("mainScreen"));
	if (screen == 0) return;
	crust_rect (*visible)(void *, void *) = (crust_rect(*)(void *, void *))objc_msgSend;
	crust_frame = visible(screen, sel_registerName("visibleFrame"));
	crust_frame_ok = 1;
}

// Writes x, y, width and height into `out` (four doubles). 1 when a screen answered, 0 otherwise.
// Called from the bridge, which crust pumps on the main thread, so no dispatch hop is needed —
// and TinyCC cannot compile a block, while `dispatch_get_main_queue` is not resolvable from it.
int shim_screen_visible_frame(double *out) {
	if (out == 0) return 0;
	crust_read_frame();
	if (!crust_frame_ok) return 0;
	out[0] = crust_frame.x;
	out[1] = crust_frame.y;
	out[2] = crust_frame.width;
	out[3] = crust_frame.height;
	return 1;
}
