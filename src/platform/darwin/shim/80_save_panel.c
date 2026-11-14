int shim_save_panel(const char *title, const char *suggested_name, const char *types,
                    int runModal) {
	// Same one-sheet rule as shim_open_panel: refusing before any state changes
	// is what keeps a pending open panel's answer readable.
	if (panel_sheet_busy()) return SHIM_PANEL_BUSY;

	if (!objc_getClass("NSSavePanel")) return SHIM_PANEL_UNSUPPORTED;
	if (!shim_responds((obj_t)objc_getClass("NSSavePanel"), sel_registerName("savePanel")))
		return SHIM_PANEL_UNSUPPORTED;

	obj_t sheet_window = 0;
	if (!runModal) {
		if (!panel_has_instance("NSSavePanel", "beginSheetModalForWindow:completionHandler:"))
			return SHIM_PANEL_UNSUPPORTED;
		if (!panel_sheet_target(&sheet_window)) return SHIM_PANEL_NO_WINDOW;
	}

	obj_t panel = ((obj_t (*)(void *, void *))objc_msgSend)(objc_getClass("NSSavePanel"),
	                                                        sel_registerName("savePanel"));
	if (!panel) return SHIM_PANEL_UNSUPPORTED;

	if (title && title[0] && panel_has_instance("NSSavePanel", "setTitle:")) {
		obj_t t = panel_nsstring(title);
		if (t) ((void (*)(void *, void *, obj_t))objc_msgSend)(panel, sel_registerName("setTitle:"), t);
	}

	// The name field's starting value. It is a bare file name; the panel still
	// lets the user change it, and a missing selector just leaves it blank.
	if (suggested_name && suggested_name[0] &&
	    panel_has_instance("NSSavePanel", "setNameFieldStringValue:")) {
		obj_t n = panel_nsstring(suggested_name);
		if (n)
			((void (*)(void *, void *, obj_t))objc_msgSend)(
			    panel, sel_registerName("setNameFieldStringValue:"), n);
	}

	panel_set_file_types("NSSavePanel", panel, types);

	if (!runModal) {
		if (!panel_sheet_block_init()) return SHIM_PANEL_UNSUPPORTED;
		panel_reset();
		panel_sheet_panel = panel;
		panel_sheet_is_save = 1;
		panel_sheet_done = 0;
		panel_sheet_response = SHIM_PANEL_NO_RESPONSE;
		((void (*)(void *, void *, obj_t, obj_t))objc_msgSend)(
		    panel, sel_registerName("beginSheetModalForWindow:completionHandler:"), sheet_window,
		    (obj_t)&panel_sheet_block);
		return SHIM_PANEL_SHEET_STARTED;
	}

	if (!panel_sheet_block_init()) return SHIM_PANEL_UNSUPPORTED;
	// Same reason as the open panel below-free-standing case: a windowless save
	// panel must not block the thread, or the app can never cancel it.
	if (!panel_has_instance("NSSavePanel", "beginWithCompletionHandler:"))
		return SHIM_PANEL_UNSUPPORTED;
	panel_reset();
	panel_sheet_panel = panel;
	panel_sheet_is_save = 1;
	panel_sheet_done = 0;
	panel_sheet_response = SHIM_PANEL_NO_RESPONSE;
	((void (*)(void *, void *, obj_t))objc_msgSend)(
	    panel, sel_registerName("beginWithCompletionHandler:"), (obj_t)&panel_sheet_block);
	return SHIM_PANEL_SHEET_STARTED;
}

// --- sheet result, for a caller that polls instead of blocking --------------

// 1 once the sheet started by shim_open_panel(…, 0) or shim_save_panel(…, 0) has
// ended, 0 while it is up (and 0 before any sheet). Answering this is the whole
// reason the sheet path no longer needs a human: the promise settles on the
// frame after the click.
