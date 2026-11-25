// --- window material -------------------------------------------------------
// A vibrancy window keeps an NSVisualEffectView behind the webview. Butter's measured setup
// (darwin.m:108-124): blendingMode BehindWindow (0), state Active (1), material Sidebar (7),
// inserted with addSubview:positioned:NSWindowBelow (-1), plus setOpaque:NO and a clear background.
// The caller is responsible for the full-size content view, transparent titlebar and a webview
// with drawsBackground=NO — without those the effect view exists but nothing shows through.

// Returns 1 when the view was inserted, 0 when AppKit does not provide the class (older macOS).
int shim_window_set_material(obj_t win) {
	if (!win) return 0;
	obj_t cls = objc_getClass("NSVisualEffectView");
	if (!cls) return 0;

	obj_t content = ((obj_t (*)(void *, void *))objc_msgSend)(win, sel_registerName("contentView"));
	if (!content) return 0;
	shim_rect bounds = ((shim_rect (*)(void *, void *))objc_msgSend)(
	    content, sel_registerName("bounds"));

	obj_t fx = ((obj_t (*)(void *, void *))objc_msgSend)(cls, sel_registerName("alloc"));
	if (!fx) return 0;
	fx = ((obj_t (*)(void *, void *, shim_rect))objc_msgSend)(
	    fx, sel_registerName("initWithFrame:"), bounds);
	if (!fx) return 0;
	crust_own(fx);

	// 2 | 16 = NSViewWidthSizable | NSViewHeightSizable.
	((void (*)(void *, void *, unsigned long long))objc_msgSend)(
	    fx, sel_registerName("setAutoresizingMask:"), 18ULL);
	((void (*)(void *, void *, int))objc_msgSend)(fx, sel_registerName("setBlendingMode:"), 0);
	((void (*)(void *, void *, int))objc_msgSend)(fx, sel_registerName("setState:"), 1);
	((void (*)(void *, void *, int))objc_msgSend)(fx, sel_registerName("setMaterial:"), 7);

	// NSWindowBelow = -1; inserting behind every existing subview is what puts the effect
	// under the webview. `relativeTo:nil` means the whole content view.
	((void (*)(void *, void *, obj_t, long long, obj_t))objc_msgSend)(
	    content, sel_registerName("addSubview:positioned:relativeTo:"), fx, -1LL, 0);
	// The content view retains the effect view; our +1 from alloc/initWithFrame: ends here.
	crust_release(fx);

	((void (*)(void *, void *, int))objc_msgSend)(win, sel_registerName("setOpaque:"), 0);
	obj_t clear = ((obj_t (*)(void *, void *))objc_msgSend)(
	    objc_getClass("NSColor"), sel_registerName("clearColor"));
	if (clear)
		((void (*)(void *, void *, obj_t))objc_msgSend)(
		    win, sel_registerName("setBackgroundColor:"), clear);
	return 1;
}
