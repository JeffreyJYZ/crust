// --- lifecycle callbacks on the same app delegate --------------------------
// Concatenated after shim/95_deeplink.c into one translation unit, so these IMPs
// attach to the CrustDeepLinkDelegate class that part creates — no second object
// and no second delegate on NSApplication. `dl_has` comes from that part.
// Each callback only records a bit; nothing blocking or throwing runs on the
// AppKit thread. `applicationShouldTerminate:` returns NSTerminateLater and JS
// calls `crust_lifecycle_settle` once its listeners have run, so a throwing
// listener is named in JS but still lets the app quit.

extern void *objc_msgSend(void *self, void *sel, ...);
extern void *objc_getClass(const char *name);
extern void *sel_registerName(const char *name);
extern int class_addMethod(void *cls, void *sel, void *imp, const char *types);

// One bit per event, so a run loop ticking faster than JS can coalesce repeats.
#define CRUST_LC_ACTIVATE 1
#define CRUST_LC_BEFORE_QUIT 2
#define CRUST_LC_WILL_QUIT 4
#define CRUST_LC_REOPEN 8
static int crust_lifecycle_events = 0;
static int crust_lifecycle_await_reply = 0;
// Set by `crust_lifecycle_immediate`, i.e. the app is already quitting and nothing may be deferred.
// Without it, `-terminate:` from `platform.quit()` answers NSTerminateLater, AppKit spins a nested
// run loop waiting for a reply that only a JS watcher would send, and `process.exit` is never
// reached — measured as `e2e:window` passing "all closed" and then hanging for 40 s.
static int crust_lifecycle_terminating = 0;

static void lc_activate(void *self, void *cmd, void *note) {
	(void)self;
	(void)cmd;
	(void)note;
	crust_lifecycle_events |= CRUST_LC_ACTIVATE;
}

static unsigned long lc_should_terminate(void *self, void *cmd, void *sender) {
	(void)self;
	(void)cmd;
	(void)sender;
	// Already quitting on our own terms: answer NSTerminateNow so AppKit does not defer. This is the
	// second entry — `platform.quit()` sends `-terminate:` after every window closed — and deferring
	// here is what left the process alive with nothing on screen.
	if (crust_lifecycle_terminating) return 1; // NSTerminateNow
	crust_lifecycle_events |= CRUST_LC_BEFORE_QUIT;
	crust_lifecycle_await_reply = 1;
	return 2; // NSTerminateLater
}

static void lc_will_terminate(void *self, void *cmd, void *note) {
	(void)self;
	(void)cmd;
	(void)note;
	crust_lifecycle_events |= CRUST_LC_WILL_QUIT;
}

static signed char lc_should_reopen(void *self, void *cmd, void *sender, signed char visible) {
	(void)self;
	(void)cmd;
	(void)sender;
	(void)visible;
	crust_lifecycle_events |= CRUST_LC_REOPEN;
	return 1; // YES — handle a Dock click even with no visible window
}

/** Add the four lifecycle methods to a delegate class; 1 on success. */
int crust_lifecycle_add_methods(void *cls) {
	if (!cls) return 0;
	return class_addMethod(cls, sel_registerName("applicationDidBecomeActive:"),
	                       (void *)lc_activate, "v@:@") &&
	       class_addMethod(cls, sel_registerName("applicationShouldTerminate:"),
	                       (void *)lc_should_terminate, "Q@:@") &&
	       class_addMethod(cls, sel_registerName("applicationWillTerminate:"),
	                       (void *)lc_will_terminate, "v@:@") &&
	       class_addMethod(cls, sel_registerName("applicationShouldHandleReopen:hasVisibleWindows:"),
	                       (void *)lc_should_reopen, "c@:@c")
	    ? 1
	    : 0;
}

// Drain the recorded bits and clear them. Returning an int keeps the FFI
// surface a plain number; the JS adapter maps each bit to an AppEvent name.
int crust_lifecycle_take(void) {
	int events = crust_lifecycle_events;
	crust_lifecycle_events = 0;
	return events;
}

// Mark that this process is quitting on its own terms, so a later `applicationShouldTerminate:`
// answers NSTerminateNow instead of deferring to a JS watcher that is already shutting down.
void crust_lifecycle_immediate(void) { crust_lifecycle_terminating = 1; }

// Answer a deferred `applicationShouldTerminate:`. A reply is sent only when a
// should-terminate was actually recorded, and only once, so an errant drain
// cannot terminate the app on its own. Returns 1 when a reply was sent.
int crust_lifecycle_settle(void) {
	if (!crust_lifecycle_await_reply) return 0;
	crust_lifecycle_await_reply = 0;
	void *appCls = objc_getClass("NSApplication");
	if (!appCls) return 0;
	void *app =
	    ((void *(*)(void *, void *))objc_msgSend)(appCls, sel_registerName("sharedApplication"));
	if (!app || !dl_has(app, "replyToApplicationShouldTerminate:")) return 0;
	((void (*)(void *, void *, signed char))objc_msgSend)(
	    app, sel_registerName("replyToApplicationShouldTerminate:"), 1);
	return 1;
}
