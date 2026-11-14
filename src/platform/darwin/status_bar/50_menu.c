// --- menu ------------------------------------------------------------------

// The menu under construction, between tray_menu_begin and tray_menu_end. Only
// one status item is built at a time: status-bar.ts refuses a second live bar,
// so a single static is the whole state.
static obj_t tray_building_menu;

int tray_menu_begin(obj_t item) {
	if (!item) return 0;
	tray_building_menu = 0;
	obj_t cls = objc_getClass("NSMenu");
	if (!cls || !tray_responds(cls, "alloc")) return 0;
	if (!tray_has_instance("NSMenu", "initWithTitle:")) return 0;
	if (!tray_has_instance("NSStatusItem", "setMenu:")) return 0;
	if (!tray_make_target()) return 0;

	obj_t title = tray_nsstring("", 0);
	if (!title) return 0;
	obj_t allocated = ((obj_t (*)(void *, void *))objc_msgSend)(cls, sel_registerName("alloc"));
	if (!allocated) return 0;
	obj_t menu = ((obj_t (*)(void *, void *, obj_t))objc_msgSend)(
	    allocated, sel_registerName("initWithTitle:"), title);
	if (!menu) return 0;
	tray_building_menu = menu;
	return 1;
}

// One row. The selector is a fixed name this file adds to its runtime class;
// `tag` carries the row index back through the click so JS can route it.
int tray_menu_add(const char *label, long long len, int tag) {
	if (!tray_building_menu) return 0;
	obj_t cls = objc_getClass("NSMenuItem");
	if (!cls || !tray_responds(cls, "alloc")) return 0;
	if (!tray_has_instance("NSMenuItem", "initWithTitle:action:keyEquivalent:")) return 0;
	if (!tray_has_instance("NSMenuItem", "setTarget:")) return 0;
	if (!tray_has_instance("NSMenu", "addItem:")) return 0;

	obj_t title = tray_nsstring(label, len);
	obj_t key = tray_nsstring("", 0);
	if (!title || !key) return 0;
	obj_t action = sel_registerName("crustTrayItemClicked:");
	obj_t allocated = ((obj_t (*)(void *, void *))objc_msgSend)(cls, sel_registerName("alloc"));
	if (!allocated) return 0;
	obj_t row = ((obj_t (*)(void *, void *, obj_t, obj_t, obj_t))objc_msgSend)(
	    allocated, sel_registerName("initWithTitle:action:keyEquivalent:"), title, action, key);
	if (!row) return 0;

	if (tray_has_instance("NSMenuItem", "setTag:")) {
		((void (*)(void *, void *, long long))objc_msgSend)(row, sel_registerName("setTag:"),
		                                                    (long long)tag);
	}
	if (!tray_responds(row, "setTarget:")) return 0;
	((void (*)(void *, void *, obj_t))objc_msgSend)(row, sel_registerName("setTarget:"),
	                                                tray_target);
	((void (*)(void *, void *, obj_t))objc_msgSend)(tray_building_menu,
	                                                sel_registerName("addItem:"), row);
	return 1;
}

// Attach the built menu to the status item and forget the builder.
int tray_menu_end(obj_t item) {
	if (!item || !tray_building_menu) return 0;
	if (!tray_has_instance("NSStatusItem", "setMenu:")) return 0;
	((void (*)(void *, void *, obj_t))objc_msgSend)(item, sel_registerName("setMenu:"),
	                                                tray_building_menu);
	tray_building_menu = 0;
	return 1;
}

// Detach the menu entirely, for an empty item list. A nil menu means a click
// does nothing, which is honest; an empty NSMenu would show an empty popup.
int tray_menu_clear(obj_t item) {
	if (!item) return 0;
	if (!tray_has_instance("NSStatusItem", "setMenu:")) return 0;
	((void (*)(void *, void *, obj_t))objc_msgSend)(item, sel_registerName("setMenu:"),
	                                                (obj_t)0);
	return 1;
}

// How many rows the attached menu has, or -1 when there is no menu.
int tray_menu_count(obj_t item) {
	if (!item) return -1;
	if (!tray_has_instance("NSStatusItem", "menu")) return -1;
	obj_t menu = ((obj_t (*)(void *, void *))objc_msgSend)(item, sel_registerName("menu"));
	if (!menu) return -1;
	if (!tray_responds(menu, "numberOfItems")) return -1;
	return (int)((long long (*)(void *, void *))objc_msgSend)(menu,
	                                                          sel_registerName("numberOfItems"));
}

// Fire one row the way AppKit does when it is clicked: `sendAction:to:from:` on the
// application, with the row as sender. This is a *test seam*, not an input synthesizer —
// it exercises target/action wiring and the trampoline, and never touches the cursor.
// Returns 1 when AppKit delivered the action.
int tray_menu_activate(obj_t item, int index) {
	if (!item || index < 0) return 0;
	if (!tray_has_instance("NSStatusItem", "menu")) return 0;
	obj_t menu = ((obj_t (*)(void *, void *))objc_msgSend)(item, sel_registerName("menu"));
	if (!menu || !tray_responds(menu, "itemAtIndex:")) return 0;
	obj_t row = ((obj_t (*)(void *, void *, long long))objc_msgSend)(
	    menu, sel_registerName("itemAtIndex:"), (long long)index);
	if (!row) return 0;
	obj_t action = ((obj_t (*)(void *, void *))objc_msgSend)(row, sel_registerName("action"));
	obj_t target = ((obj_t (*)(void *, void *))objc_msgSend)(row, sel_registerName("target"));
	if (!action) return 0;
	obj_t app = ((obj_t (*)(void *, void *))objc_msgSend)(
	    objc_getClass("NSApplication"), sel_registerName("sharedApplication"));
	if (!app) return 0;
	return (int)(char)((char (*)(void *, void *, obj_t, obj_t, obj_t))objc_msgSend)(
	    app, sel_registerName("sendAction:to:from:"), action, target, row);
}

// The clicked row's index, read from the sender AppKit passes to the IMP.
int tray_item_index(obj_t sender) {
	if (!sender || !tray_responds(sender, "tag")) return -1;
	return (int)((long long (*)(void *, void *))objc_msgSend)(sender, sel_registerName("tag"));
}

// --- teardown --------------------------------------------------------------

