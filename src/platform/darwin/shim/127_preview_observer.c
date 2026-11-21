// --- QuickLook preview: the window's own close ------------------------------
// Third part, between the data source and the panel.
// A panel is its own window, so it has to be ordered out while the app still has a key window: a
// frame after the owner's `-close` lands, measured twice on macOS 27, `-orderOut:` leaves
// `-isVisible` 1 and the panel still on screen (`screencapture -l` returned the same 66 118 bytes
// before and after). So the teardown is a `NSWindowWillCloseNotification` observer for the one
// window the panel was shown over — not the poll, which stays only as a last resort for a window
// that closed before this observer existed.
//
// The observer is a runtime-built class with one IMP, the same device the data source uses: a block
// would need the hand-built global block `70_sheet_block.c` carries, and this needs nothing a
// selector cannot do.

static pv_t preview_observer_class;
static pv_t preview_observer;
// Defined with the panel, because it reads the shared panel; declared here so the handler can call
// it without a second translation unit. The same for the forget below, which the handler uses.
static void preview_order_out(void);
static void preview_observer_forget(void);

static void preview_will_close_imp(pv_t self, void *cmd, pv_t note) {
	(void)self;
	(void)cmd;
	(void)note;
	// The window is still open here, which is the only moment `-orderOut:` works.
	preview_order_out();
	preview_owner = 0;
	preview_observer_forget();
	preview_reason_set("the owning window is closing, so the panel was ordered out");
}

// `-[NSNotificationCenter defaultCenter]`.
static pv_t preview_center(void) {
	pv_t cls = objc_getClass("NSNotificationCenter");
	if (!cls) return 0;
	return pv_msg0(cls, "defaultCenter");
}

// One class per process, reused if a previous unit in this process built it.
static int preview_observer_init(void) {
	if (preview_observer_class) return 1;
	pv_t base = objc_getClass("NSObject");
	if (!base) return 0;
	pv_t cls = objc_getClass("CrustPreviewObserver");
	if (!cls) {
		cls = objc_allocateClassPair(base, "CrustPreviewObserver", 0);
		if (!cls) return 0;
		class_addMethod(cls, sel_registerName("windowWillClose:"), (pv_imp)preview_will_close_imp,
		                "v@:@");
		objc_registerClassPair(cls);
	}
	preview_observer_class = cls;
	return 1;
}

// Watch one window. A new show over another window drops the old registration first, so a panel is
// never taken down by a window it is not over.
static int preview_observer_watch(pv_t window) {
	preview_observer_forget();
	if (!window) return 0;
	if (!preview_observer_init()) return 0;
	pv_t center = preview_center();
	if (!center) return 0;
	if (!pv_has("NSNotificationCenter", "addObserver:selector:name:object:")) return 0;
	if (!preview_observer) {
		pv_t allocated = pv_msg0(preview_observer_class, "alloc");
		if (!allocated) return 0;
		preview_observer = pv_msg0(allocated, "init");
		if (!preview_observer) return 0;
	}
	// The name is built from its bytes rather than read off the AppKit symbol: NSNotificationCenter
	// filters by name equality, and a data symbol from a second framework is one more link-time
	// promise for a string that never changes.
	pv_t name = pv_nsstring("NSWindowWillCloseNotification");
	if (!name) return 0;
	((void (*)(void *, void *, pv_t, pv_t, pv_t, pv_t))objc_msgSend)(
	    center, sel_registerName("addObserver:selector:name:object:"), preview_observer,
	    sel_registerName("windowWillClose:"), name, window);
	return 1;
}

static void preview_observer_forget(void) {
	if (!preview_observer) return;
	pv_t center = preview_center();
	if (center && pv_has("NSNotificationCenter", "removeObserver:"))
		pv_msg1(center, "removeObserver:", preview_observer);
}
