// --- QuickLook preview: the panel -------------------------------------------
// Third part, after the file list (`125_preview.c`) and the data source (`126_preview_data.c`).
// `QLPreviewPanel` is a singleton the app does not own: `+sharedPreviewPanel` hands out the system's
// one panel, so it is driven and never allocated, and `-orderOut:` is the only teardown that
// reaches it. Its position is not ours either — the panel floats over the app's window as its own
// window, which is why the owner is recorded here and read back by the pump's poll.

// QuickLookUI is loaded by the link first; this is the fallback when nothing referenced it, so a
// process still reaches the class. RTLD_LAZY is 1.
extern void *dlopen(const char *path, int mode);

// The window the panel was shown over, and the one-shot flag that keeps dlopen from repeating.
static int preview_opened_lookui;

int shim_preview_available(void) {
	pv_t cls = objc_getClass("QLPreviewPanel");
	if (!cls && !preview_opened_lookui) {
		preview_opened_lookui = 1;
		dlopen("/System/Library/Frameworks/QuickLookUI.framework/QuickLookUI", 1);
		cls = objc_getClass("QLPreviewPanel");
	}
	if (!pv_class_responds(cls, "sharedPreviewPanel")) {
		preview_reason_set("QLPreviewPanel is not reachable (QuickLookUI did not load)");
		return 0;
	}
	return 1;
}

// `+sharedPreviewPanel`. This may load the QuickLook generators the first time, which is why it is
// reached from `show` and the reads, never from `available`.
static pv_t preview_panel(void) {
	if (!shim_preview_available()) return 0;
	return pv_msg0(objc_getClass("QLPreviewPanel"), "sharedPreviewPanel");
}

// The one teardown: `-orderOut:`, sent to NSWindow's own implementation. QLPreviewPanel overrides it
// and that override leaves `-isVisible` answering YES — measured on macOS 27 in `e2e:preview`: an
// orderOut: to the class as-is, and to its immediate superclass, both kept the panel reading
// visible, while the same selector starting at NSWindow cleared it in the same turn.
// `objc_msgSendSuper`'s second word is the class the lookup starts at, so naming NSWindow skips the
// panel's override. Called from the observer while the owner is still open, from `hide`, and as the
// poll's last resort.
extern void *objc_msgSendSuper(void *target, void *sel, ...);

static void preview_order_out(void) {
	pv_t panel = preview_panel();
	if (!panel) return;
	if (!pv_has("QLPreviewPanel", "orderOut:")) return;
	// `struct objc_super`'s two words do not cross bun:ffi, so they are built here as an array.
	void *target[2];
	target[0] = panel;
	target[1] = objc_getClass("NSWindow");
	((void (*)(void *, void *, pv_t))objc_msgSendSuper)(target, sel_registerName("orderOut:"), 0);
}

int shim_preview_show(void *owner, double width, double height) {
	if (preview_paths_used <= 0) {
		preview_reason_set("no file was offered to the panel");
		return SHIM_PREVIEW_NO_PATHS;
	}
	pv_t panel = preview_panel();
	if (!panel) return SHIM_PREVIEW_UNAVAILABLE;
	pv_t source = preview_source();
	if (!source) {
		preview_reason_set("the preview data source class could not be built");
		return SHIM_PREVIEW_UNAVAILABLE;
	}
	if (!pv_has("QLPreviewPanel", "setDataSource:") ||
	    !pv_has("QLPreviewPanel", "makeKeyAndOrderFront:")) {
		preview_reason_set("QLPreviewPanel is missing setDataSource: or makeKeyAndOrderFront:");
		return SHIM_PREVIEW_UNAVAILABLE;
	}

	pv_msg1(panel, "setDataSource:", source);
	if (pv_has("QLPreviewPanel", "reloadData")) pv_msg0(panel, "reloadData");
	// A panel that joins no Space is invisible the moment the app is fullscreen, so it is given the
	// pair the window's own collection behaviour relies on: canJoinAllSpaces (1) plus
	// fullScreenAuxiliary (1 << 8).
	if (pv_has("QLPreviewPanel", "setCollectionBehavior:"))
		((void (*)(void *, void *, long long))objc_msgSend)(
		    panel, sel_registerName("setCollectionBehavior:"), 1LL | 256LL);
	// An explicit size is honoured only when both halves arrive; a panel sized 0x0 is a blank panel,
	// so a one-sided request is ignored rather than applied.
	if (width > 0 && height > 0 && pv_has("QLPreviewPanel", "setContentSize:")) {
		pv_size size;
		size.width = width;
		size.height = height;
		((void (*)(void *, void *, pv_size))objc_msgSend)(panel, sel_registerName("setContentSize:"),
		                                                 size);
	}
	pv_msg1(panel, "makeKeyAndOrderFront:", 0);
	preview_owner = (pv_t)owner;
	// The panel has to go when the window does, and `-orderOut:` only works while the window is
	// still open, so the close is watched rather than polled.
	preview_observer_watch((pv_t)owner);
	preview_reason_set("shown");
	return SHIM_PREVIEW_OK;
}

int shim_preview_hide(void) {
	pv_t panel = preview_panel();
	if (!panel) return SHIM_PREVIEW_UNAVAILABLE;
	if (!pv_has("QLPreviewPanel", "orderOut:")) {
		preview_reason_set("QLPreviewPanel is missing orderOut:");
		return SHIM_PREVIEW_UNAVAILABLE;
	}
	preview_observer_forget();
	preview_order_out();
	preview_owner = 0;
	preview_reason_set("hidden");
	return SHIM_PREVIEW_OK;
}

int shim_preview_visible(void) {
	pv_t panel = preview_panel();
	if (!panel) return 0;
	if (!pv_has("QLPreviewPanel", "isVisible")) return 0;
	return (int)(char)((char (*)(void *, void *))objc_msgSend)(panel, sel_registerName("isVisible"));
}

// Keys go to the panel while it is up, which is the point of `-makeKeyAndOrderFront:`: a proof reads
// this rather than trusting that the order landed.
int shim_preview_key(void) {
	pv_t panel = preview_panel();
	if (!panel) return 0;
	if (!pv_has("QLPreviewPanel", "isKeyWindow")) return 0;
	return (int)(char)((char (*)(void *, void *))objc_msgSend)(panel,
	                                                           sel_registerName("isKeyWindow"));
}

// The window number of the panel, so a proof can name the window QuickLook drew into. It keeps its
// value after the panel is ordered out, so it only means anything beside `shim_preview_visible`.
int shim_preview_window_number(void) {
	pv_t panel = preview_panel();
	if (!panel) return 0;
	if (!pv_has("QLPreviewPanel", "windowNumber")) return 0;
	return (int)(long long)((long long (*)(void *, void *))objc_msgSend)(
	    panel, sel_registerName("windowNumber"));
}

// The window the panel floats over, or 0: what `previewWindowClosed` compares before hiding, so a
// second window's close cannot close the first window's preview.
void *shim_preview_owner(void) { return preview_owner; }

// Whether the window the panel was shown over is still on screen, hiding the panel when it is not.
// This is what a window closed by its own red button needs: that close never reaches
// `Platform.destroy`, so the pump's poll is the only thing between it and a panel floating over the
// desktop.
int shim_preview_owner_live(void) {
	if (!preview_owner) return 1;
	// `-isVisible` is 0 once the window closed and 1 while it is only ordered out, which is the
	// distinction `windowLiveness` carries for the same reason.
	if (pv_has("NSWindow", "isVisible")) {
		int visible = (int)(char)((char (*)(void *, void *))objc_msgSend)(
		    preview_owner, sel_registerName("isVisible"));
		if (visible) return 1;
	}
	preview_owner = 0;
	// The observer normally got here first, while the window was still open. This path exists for a
	// window that closed before the observer was installed, and it may be too late to hide anything.
	preview_observer_forget();
	preview_order_out();
	preview_reason_set("the owning window closed, so the panel was ordered out");
	return 0;
}
