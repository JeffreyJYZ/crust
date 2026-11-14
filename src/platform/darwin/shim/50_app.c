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

