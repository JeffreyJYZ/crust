// --- window chrome ---------------------------------------------------------
// Opacity is the one chrome read the send ladder cannot express: -alphaValue
// returns a double and no ladder prototype returns one, so the pair lives here.
// The rest of the chrome is plain sends JS already has (styleMask, setStyleMask:,
// the NSCursor class methods), and keeping them in JS is what lets a double
// prove the frame-restore rule without a window.

// A null window reads as opaque, AppKit's own default, so a caller never sees a
// bogus 0 and treats a live window as invisible.
double shim_window_opacity(obj_t win) {
	if (!win) return 1.0;
	return ((double (*)(void *, void *))objc_msgSend)(win, sel_registerName("alphaValue"));
}

// 0 and 1 are both legitimate: 1 is opaque and 0 is fully transparent. The
// range is checked in JS, which refuses 1.5 rather than letting AppKit clamp.
void shim_window_set_opacity(obj_t win, double value) {
	if (!win) return;
	((void (*)(void *, void *, double))objc_msgSend)(win, sel_registerName("setAlphaValue:"),
	                                                 value);
}

// `+hide` is a counter, not a flag: two hides need two unhides before the
// pointer is back, so the caller sends exactly one of the pair per request and
// the class object is the receiver here rather than a window.
void shim_cursor_visible(int visible) {
	obj_t cursor_class = objc_getClass("NSCursor");
	if (!cursor_class) return;
	((void (*)(void *, void *))objc_msgSend)(cursor_class,
	                                        sel_registerName(visible ? "unhide" : "hide"));
}
