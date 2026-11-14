int shim_open_panel(const char *title, const char *types, int allowDirectories, int allowMultiple,
                    int runModal) {
	// A request that cannot be honoured leaves the live sheet untouched. This
	// checked nothing until now, and resetting first meant a second request
	// wiped the first one's panel pointer, done flag and path storage.
	if (panel_sheet_busy()) return SHIM_PANEL_BUSY;

	// The panel class and its factory must exist before anything is built.
	if (!objc_getClass("NSOpenPanel")) return SHIM_PANEL_UNSUPPORTED;
	if (!shim_responds((obj_t)objc_getClass("NSOpenPanel"),
	                   sel_registerName("openPanel")))
		return SHIM_PANEL_UNSUPPORTED;

	// A sheet needs a window first: sending beginSheet… with a nil window is an
	// AppKit exception, and an exception here is a crashed process.
	obj_t sheet_window = 0;
	if (!runModal) {
		if (!panel_has_instance("NSOpenPanel", "beginSheetModalForWindow:completionHandler:"))
			return SHIM_PANEL_UNSUPPORTED;
		if (!panel_sheet_target(&sheet_window)) return SHIM_PANEL_NO_WINDOW;
	}

	obj_t panel = ((obj_t (*)(void *, void *))objc_msgSend)(objc_getClass("NSOpenPanel"),
	                                                        sel_registerName("openPanel"));
	if (!panel) return SHIM_PANEL_UNSUPPORTED;

	// Selection shape. Both flags are BOOL parameters, sent as an int exactly
	// like shim_send_vb1 does; every one is guarded first.
	if (!panel_has_instance("NSOpenPanel", "setCanChooseFiles:") ||
	    !panel_has_instance("NSOpenPanel", "setCanChooseDirectories:") ||
	    !panel_has_instance("NSOpenPanel", "setAllowsMultipleSelection:"))
		return SHIM_PANEL_UNSUPPORTED;
	((void (*)(void *, void *, int))objc_msgSend)(
	    panel, sel_registerName("setCanChooseFiles:"), allowDirectories ? 0 : 1);
	((void (*)(void *, void *, int))objc_msgSend)(
	    panel, sel_registerName("setCanChooseDirectories:"), allowDirectories ? 1 : 0);
	((void (*)(void *, void *, int))objc_msgSend)(
	    panel, sel_registerName("setAllowsMultipleSelection:"), allowMultiple ? 1 : 0);

	if (title && title[0] && panel_has_instance("NSOpenPanel", "setTitle:")) {
		obj_t t = panel_nsstring(title);
		if (t) ((void (*)(void *, void *, obj_t))objc_msgSend)(panel, sel_registerName("setTitle:"), t);
	}

	// File-type filters, comma-separated because a JS array cannot cross the
	// boundary. A missing selector leaves the panel unfiltered rather than
	// aborting the pick.
	panel_set_file_types("NSOpenPanel", panel, types);

	if (!runModal) {
		if (!panel_sheet_block_init()) return SHIM_PANEL_UNSUPPORTED;
		// Take over the shared storage only now: the live panel has to be set
		// before the send, because the handler reads it to collect -URLs and a
		// sheet that ends immediately must still find it.
		panel_reset();
		panel_sheet_panel = panel;
		panel_sheet_done = 0;
		panel_sheet_response = SHIM_PANEL_NO_RESPONSE;
		((void (*)(void *, void *, obj_t, obj_t))objc_msgSend)(
		    panel, sel_registerName("beginSheetModalForWindow:completionHandler:"), sheet_window,
		    (obj_t)&panel_sheet_block);
		return SHIM_PANEL_SHEET_STARTED;
	}

	if (!panel_sheet_block_init()) return SHIM_PANEL_UNSUPPORTED;
	// No window to attach a sheet to, so present the panel on its own. `-runModal`
	// would block this thread until a human answers, and a windowless app would
	// then have no way out at all: nothing else can run, so `dialog.cancel` never
	// gets the chance to fire. `-beginWithCompletionHandler:` presents the same
	// panel, returns at once and reports through the same completion block, so the
	// poll and the cancel below work here unchanged (measured 2026-11-14).
	if (!panel_has_instance("NSOpenPanel", "beginWithCompletionHandler:"))
		return SHIM_PANEL_UNSUPPORTED;
	panel_reset();
	panel_sheet_panel = panel;
	panel_sheet_is_save = 0;
	panel_sheet_done = 0;
	panel_sheet_response = SHIM_PANEL_NO_RESPONSE;
	((void (*)(void *, void *, obj_t))objc_msgSend)(
	    panel, sel_registerName("beginWithCompletionHandler:"), (obj_t)&panel_sheet_block);
	return SHIM_PANEL_SHEET_STARTED;
}

int shim_open_panel_count(void) { return panel_paths_used; }

// The path at `index`, or "" out of range. Static storage: valid until the next
// shim_open_panel or shim_save_panel call, which is all a caller needs.
const char *shim_open_panel_path(int index) {
	if (index < 0 || index >= panel_paths_used) return "";
	return panel_paths[index];
}

// Opens an NSSavePanel. Same two modes, same statuses, same storage as
// shim_open_panel; the caller supplies a suggested file name and an allowed
// extension list instead of a selection shape.
//
// Overwrite confirmation is AppKit's own job: NSSavePanel asks before replacing
// an existing file, and nothing here suppresses that prompt or adds a second
// confirmation of ours. crust never writes the file — the caller does, after
// the panel answers.
