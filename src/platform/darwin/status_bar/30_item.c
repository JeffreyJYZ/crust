// --- status item -----------------------------------------------------------

// Compile/link round-trip for the test suite: proves AppKit really links here
// the way NSHomeDirectory proves Foundation links in research/cc.md.
int tray_abi(void) { return 1; }

// The status item, sized to its content. `imp` is the JavaScript callback that
// becomes the menu target's IMP; a menu is only usable when it is non-null.
// Returns 0 when NSStatusBar or a selector it needs is absent, never a crash.
obj_t tray_create(void *imp) {
	if (!imp) return 0;
	tray_click_imp = imp;

	obj_t bar_cls = objc_getClass("NSStatusBar");
	if (!bar_cls) return 0;
	if (!tray_responds(bar_cls, "systemStatusBar")) return 0;
	if (!tray_has_instance("NSStatusBar", "statusItemWithLength:")) return 0;
	obj_t bar = ((obj_t (*)(void *, void *))objc_msgSend)(bar_cls,
	                                                     sel_registerName("systemStatusBar"));
	if (!bar) return 0;

	// NSVariableStatusItemLength is -1.0: the item sizes itself to its content.
	obj_t item = ((obj_t (*)(void *, void *, double))objc_msgSend)(
	    bar, sel_registerName("statusItemWithLength:"), -1.0);
	return item ? item : 0;
}

// The title, built and applied on this side. `-[NSStatusItem title]` exists on
// 10.12+, and the button is the older surface; whichever is present is used and
// the applied title is read back by tray_title_copy, so a silent no-op is
// visible to JS instead of looking like success.
int tray_set_title(obj_t item, const char *bytes, long long len) {
	if (!item) return 0;
	obj_t title = tray_nsstring(bytes, len);
	if (!title) return 0;

	if (tray_has_instance("NSStatusItem", "setTitle:")) {
		((void (*)(void *, void *, obj_t))objc_msgSend)(item, sel_registerName("setTitle:"),
		                                                title);
		return 1;
	}
	if (!tray_has_instance("NSStatusItem", "button")) return 0;
	obj_t button = ((obj_t (*)(void *, void *))objc_msgSend)(item, sel_registerName("button"));
	if (!button || !tray_responds(button, "setTitle:")) return 0;
	((void (*)(void *, void *, obj_t))objc_msgSend)(button, sel_registerName("setTitle:"), title);
	return 1;
}

#define TRAY_TITLE_BYTES 512
static char tray_title_buf[TRAY_TITLE_BYTES];

// The size of the readback buffer, so JS knows when a comparison is meaningful.
int tray_title_capacity(void) { return TRAY_TITLE_BYTES; }

static obj_t tray_status_title(obj_t item) {
	if (tray_has_instance("NSStatusItem", "title")) {
		obj_t title = ((obj_t (*)(void *, void *))objc_msgSend)(item, sel_registerName("title"));
		if (title) return title;
	}
	if (!tray_has_instance("NSStatusItem", "button")) return 0;
	obj_t button = ((obj_t (*)(void *, void *))objc_msgSend)(item, sel_registerName("button"));
	if (!button || !tray_responds(button, "title")) return 0;
	return ((obj_t (*)(void *, void *))objc_msgSend)(button, sel_registerName("title"));
}

// The applied title copied into static storage: a `const char *` return, never
// an NSString across the boundary. Bounded by TRAY_TITLE_BYTES.
const char *tray_title_copy(obj_t item) {
	tray_title_buf[0] = 0;
	if (!item) return tray_title_buf;
	obj_t title = tray_status_title(item);
	if (!title || !tray_responds(title, "UTF8String")) return tray_title_buf;
	const char *utf8 = ((const char *(*)(void *, void *))objc_msgSend)(title,
	                                                                  sel_registerName("UTF8String"));
	if (!utf8) return tray_title_buf;
	long i = 0;
	while (utf8[i] && i < TRAY_TITLE_BYTES - 1) {
		tray_title_buf[i] = utf8[i];
		i++;
	}
	tray_title_buf[i] = 0;
	return tray_title_buf;
}

// Show or hide the item. `-[NSStatusItem setVisible:]` is the only supported
// route; an absent selector is a 0, and status-bar.ts turns that into a typed
// failure rather than pretending the item moved.
int tray_set_visible(obj_t item, int visible) {
	if (!item) return 0;
	if (!tray_has_instance("NSStatusItem", "setVisible:")) return 0;
	((void (*)(void *, void *, int))objc_msgSend)(item, sel_registerName("setVisible:"),
	                                              visible ? 1 : 0);
	return 1;
}

