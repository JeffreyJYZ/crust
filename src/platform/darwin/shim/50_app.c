// --- application ----------------------------------------------------------

int shim_app_load(void) { return (int)NSApplicationLoad(); }

/**
 * Set the dock icon from a file path. Butter does the same at window creation from `BUTTER_ICON`, and
 * crust had no runtime path at all: `app.icon` reached only the packaged `.app`'s `Info.plist`, so a
 * built app showed its icon and the same app under `crust dev` showed the generic one.
 *
 * Returns 0 when the image could not be loaded, so the caller reports a name rather than a silent
 * no-op. The `NSImage` is autoreleased by the pool the caller already holds open.
 */
int shim_app_set_icon(const char *path) {
	if (!path) return 0;
	obj_t cls = objc_getClass("NSImage");
	if (!cls) return 0;
	obj_t allocd = ((obj_t (*)(void *, void *))objc_msgSend)(cls, sel_registerName("alloc"));
	if (!allocd) return 0;
	obj_t str = ((obj_t (*)(void *, void *))objc_msgSend)(objc_getClass("NSString"),
	                                                      sel_registerName("alloc"));
	if (!str) return 0;
	obj_t file = ((obj_t (*)(void *, void *, const char *, unsigned long,
	                         long long))objc_msgSend)(
	    str, sel_registerName("initWithBytes:length:encoding:"), path,
	    (unsigned long)shim_cstr_len(path), 4LL);
	if (!file) return 0;
	obj_t image = ((obj_t (*)(void *, void *, obj_t))objc_msgSend)(
	    allocd, sel_registerName("initWithContentsOfFile:"), file);
	if (!image) return 0;
	obj_t application = ((obj_t (*)(void *, void *))objc_msgSend)(
	    objc_getClass("NSApplication"), sel_registerName("sharedApplication"));
	if (!application) return 0;
	((void (*)(void *, void *, obj_t))objc_msgSend)(application,
	                                                sel_registerName("setApplicationIconImage:"),
	                                                image);
	return 1;
}

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

// The pump: drain the AppKit queue without waiting, then give WebKit a 2 ms run-loop slice.
// A `research/runloop` sweep found 0.25 ms delivered 186 of 187 ticks while 4 ms delivered only
// 82.4% of a 16 ms tick; a measured perf-pump run showed the shipped 4 ms `nextEventMatchingMask:`
// deadline holding the JS thread 6.84 ms per tick at 41 ticks/s, with only 1.7% process CPU.
// That wait was sleep, not work: pass a nil deadline so an empty queue returns at once, and leave
// `CFRunLoopRunInMode` to service the sources that actually paint. `CFRunLoopRunInMode` alone does
// not draw, so a queued event still goes through `sendEvent:` and `updateWindows`.
static obj_t shim_default_mode(void) { return __CFStringMakeConstantString("kCFRunLoopDefaultMode"); }

// Does this thread own the main run loop? If it does not, pumping here can never drive
// AppKit's rendering, and no amount of slice tuning will help.
int shim_on_main_runloop(void) { return CFRunLoopGetMain() == CFRunLoopGetCurrent(); }

// NSWindowOcclusionStateVisible is bit 2. The WindowServer clears it when the window is minimised,
// covered, on another Space, or its app is hidden — exactly when WebKit has stopped painting. This
// reads the state AppKit already tracks; it never disables occlusion detection (that is a probe trick).
static int shim_window_occluded(obj_t win) {
	obj_t mini = sel_registerName("isMiniaturized");
	if (shim_responds(win, mini) &&
	    ((char (*)(void *, void *))objc_msgSend)(win, mini)) return 1;
	obj_t sel = sel_registerName("occlusionState");
	if (shim_responds(win, sel)) {
		long long state = ((long long (*)(void *, void *))objc_msgSend)(win, sel);
		return (state & 2LL) == 0;
	}
	return ((char (*)(void *, void *))objc_msgSend)(win, sel_registerName("isVisible")) == 0;
}

static int shim_window_exists(obj_t win) {
	obj_t mini = sel_registerName("isMiniaturized");
	return ((char (*)(void *, void *))objc_msgSend)(win, sel_registerName("isVisible")) != 0 ||
	       (shim_responds(win, mini) &&
	        ((char (*)(void *, void *))objc_msgSend)(win, mini) != 0);
}

/**
 * A fresh window can report itself not composited while its page is still loading. Fail open for
 * the first 120 ticks so the page always loads, then allow the backoff. One-way in the sense that
 * the counter only grows; revealing a window always gets a normal tick immediately after.
 */
static unsigned long shim_pump_ticks = 0;
#define SHIM_STARTUP_TICKS 120UL

/** Fail open (keep pumping) when the answer is unknown or there is no window to judge. */
static int shim_any_window_painting(obj_t app) {
	if (shim_pump_ticks++ < SHIM_STARTUP_TICKS) return 1;
	if (!app || !shim_responds(app, sel_registerName("windows"))) return 1;
	obj_t hidden = sel_registerName("isHidden");
	if (shim_responds(app, hidden) &&
	    ((char (*)(void *, void *))objc_msgSend)(app, hidden)) return 0;
	obj_t windows = ((obj_t (*)(void *, void *))objc_msgSend)(app, sel_registerName("windows"));
	if (!windows || !shim_responds(windows, sel_registerName("count"))) return 1;
	unsigned long count = ((unsigned long (*)(void *, void *))objc_msgSend)(
	    windows, sel_registerName("count"));
	if (count == 0) return 1;
	obj_t at = sel_registerName("objectAtIndex:");
	int anyWindow = 0;
	int anyPainting = 0;
	for (unsigned long i = 0; i < count; i++) {
		obj_t win = ((obj_t (*)(void *, void *, unsigned long))objc_msgSend)(windows, at, i);
		if (!win) continue;
		if (shim_window_exists(win)) anyWindow = 1;
		if (!shim_window_occluded(win)) anyPainting = 1;
	}
	return anyPainting || !anyWindow;
}

// The per-tick pool still matters: `nextEventMatchingMask:` hands back an autoreleased NSEvent, and
// several other shim units leave their +0 objects "to the pool the pump drains". Passing a nil date
// removes the two NSDate allocations and, more importantly, the 4 ms wait when the queue is empty.
int shim_pump(obj_t mode) {
	obj_t pool = shim_pool_new();
	int result = 0;
	if (pool) shim_pool_init(pool);
	if (!mode) mode = shim_default_mode();
	obj_t app = ((obj_t (*)(void *, void *))objc_msgSend)(
	    objc_getClass("NSApplication"), sel_registerName("sharedApplication"));
	if (!app) {
		result = CFRunLoopRunInMode(mode, 0.004, 0);
	} else if (!shim_any_window_painting(app)) {
		// -1 tells the JS pump to back off: AppKit has no visible window to service.
		result = -1;
	} else {
		obj_t event = ((obj_t (*)(void *, void *, unsigned long, obj_t, obj_t, signed char))
		                   objc_msgSend)(
		    app, sel_registerName("nextEventMatchingMask:untilDate:inMode:dequeue:"), ~0UL, 0, mode, 1);
		if (event) {
			((void (*)(void *, void *, obj_t))objc_msgSend)(app, sel_registerName("sendEvent:"),
			                                               event);
			((void (*)(void *, void *))objc_msgSend)(app, sel_registerName("updateWindows"));
			result = 1;
		} else {
			result = CFRunLoopRunInMode(mode, 0.00025, 0);
		}
	}
	if (pool) shim_pool_drain(pool);
	return result;
}

