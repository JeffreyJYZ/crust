// --- readback for evidence -------------------------------------------------
// AppKit's claims about the item besides the title: visibility flag, reserved
// length, the button's window. Each returns a primitive, so nothing crosses as
// an object or struct, and each is preflighted. Never proof a pixel was drawn —
// a screenshot is that proof, and a run reports the two separately.

// -1 means "this AppKit has no -[NSStatusItem isVisible]", which is different
// from 0, an item AppKit itself calls hidden.
int tray_item_visible(obj_t item) {
	if (!item) return -1;
	if (!tray_has_instance("NSStatusItem", "isVisible")) return -1;
	return (int)(char)((char (*)(void *, void *))objc_msgSend)(item,
	                                                           sel_registerName("isVisible"));
}

// The width AppKit reserved for the item, in points. -1.0 when absent.
double tray_item_length(obj_t item) {
	if (!item) return -1.0;
	if (!tray_has_instance("NSStatusItem", "length")) return -1.0;
	return ((double (*)(void *, void *))objc_msgSend)(item, sel_registerName("length"));
}

// The button's window number, which is the identity `screencapture -l` takes.
// 0 when the item has no button, the button has no window, or that window has
// no number — all three are the honest "nothing to capture" answer.
long long tray_button_window(obj_t item) {
	if (!item) return 0;
	if (!tray_has_instance("NSStatusItem", "button")) return 0;
	obj_t button = ((obj_t (*)(void *, void *))objc_msgSend)(item, sel_registerName("button"));
	if (!button || !tray_responds(button, "window")) return 0;
	obj_t window = ((obj_t (*)(void *, void *))objc_msgSend)(button, sel_registerName("window"));
	if (!window || !tray_responds(window, "windowNumber")) return 0;
	return (long long)((long long (*)(void *, void *))objc_msgSend)(window,
	                                                                sel_registerName("windowNumber"));
}

// -[NSWindow isVisible] for that window: 1 on screen, 0 not, -1 no window.
int tray_button_window_visible(obj_t item) {
	if (!item) return -1;
	if (!tray_has_instance("NSStatusItem", "button")) return -1;
	obj_t button = ((obj_t (*)(void *, void *))objc_msgSend)(item, sel_registerName("button"));
	if (!button || !tray_responds(button, "window")) return -1;
	obj_t window = ((obj_t (*)(void *, void *))objc_msgSend)(button, sel_registerName("window"));
	if (!window || !tray_responds(window, "isVisible")) return -1;
	return (int)(char)((char (*)(void *, void *))objc_msgSend)(window,
	                                                           sel_registerName("isVisible"));
}

// The button window's frame on screen, written as four doubles into `out`;
// never returned as a struct. `-[NSWindow frame]` is read through KVC, which
// hands back an NSValue that -getValue: unpacks into the caller's buffer, so no
// struct and no object crosses the boundary. Returns 1 when a frame was
// written, 0 when there is no button window to read.
int tray_button_window_frame(obj_t item, double *out) {
	if (!item || !out) return 0;
	if (!tray_has_instance("NSStatusItem", "button")) return 0;
	obj_t button = ((obj_t (*)(void *, void *))objc_msgSend)(item, sel_registerName("button"));
	if (!button || !tray_responds(button, "window")) return 0;
	obj_t window = ((obj_t (*)(void *, void *))objc_msgSend)(button, sel_registerName("window"));
	if (!window || !tray_responds(window, "valueForKey:")) return 0;

	obj_t key = tray_nsstring("frame", 5);
	if (!key) return 0;
	obj_t box = ((obj_t (*)(void *, void *, obj_t))objc_msgSend)(window,
	                                                            sel_registerName("valueForKey:"), key);
	if (!box || !tray_responds(box, "getValue:")) return 0;
	((void (*)(void *, void *, void *))objc_msgSend)(box, sel_registerName("getValue:"), out);
	return 1;
}

// -[NSWindow occlusionState], the WindowServer's own answer rather than
// AppKit's intention: bit 2 (NSWindowOcclusionStateVisible) is set only while
// the window is actually composited on screen. -1 when absent.
long long tray_button_window_occlusion(obj_t item) {
	if (!item) return -1;
	if (!tray_has_instance("NSStatusItem", "button")) return -1;
	obj_t button = ((obj_t (*)(void *, void *))objc_msgSend)(item, sel_registerName("button"));
	if (!button || !tray_responds(button, "window")) return -1;
	obj_t window = ((obj_t (*)(void *, void *))objc_msgSend)(button, sel_registerName("window"));
	if (!window || !tray_responds(window, "occlusionState")) return -1;
	return (long long)((unsigned long long (*)(void *, void *))objc_msgSend)(
	    window, sel_registerName("occlusionState"));
}

// Whether that window belongs to the Space the user is looking at: 1 yes,
// 0 no, -1 no window. A fullscreen Space takes the menu bar away, so this is
// the field that explains an item with no pixels.
int tray_button_window_active_space(obj_t item) {
	if (!item) return -1;
	if (!tray_has_instance("NSStatusItem", "button")) return -1;
	obj_t button = ((obj_t (*)(void *, void *))objc_msgSend)(item, sel_registerName("button"));
	if (!button || !tray_responds(button, "window")) return -1;
	obj_t window = ((obj_t (*)(void *, void *))objc_msgSend)(button, sel_registerName("window"));
	if (!window || !tray_responds(window, "isOnActiveSpace")) return -1;
	return (int)(char)((char (*)(void *, void *))objc_msgSend)(window,
	                                                            sel_registerName("isOnActiveSpace"));
}

