// --- main menu -------------------------------------------------------------
// ⌘Q, ⌘C and ⌘V live on main-menu items, not in the webview: AppKit dispatches a
// key equivalent to its item's action, and the Edit rows keep a nil target so the
// action walks to whichever field or view is first responder. An app with no
// -[NSApp mainMenu] therefore has none of those three shortcuts — that was the
// bug. Every title is built and read here: a short ASCII NSString is a tagged
// pointer and nothing of that shape may cross bun:ffi.

// One NSString, consumed on this side. `+stringWithUTF8String:` aborts Bun, so
// `-initWithBytes:length:encoding:` (4 = UTF8) with an explicit length is the only
// constructor used; length 0 is the empty title a bar entry needs.
static obj_t menu_nsstring(const char *s, long long len) {
	if (!s) return 0;
	obj_t allocd = ((obj_t (*)(void *, void *))objc_msgSend)(objc_getClass("NSString"),
	                                                        sel_registerName("alloc"));
	if (!allocd) return 0;
	return ((obj_t (*)(void *, void *, const char *, unsigned long, long long))objc_msgSend)(
	    allocd, sel_registerName("initWithBytes:length:encoding:"), s, (unsigned long)len, 4LL);
}

// [obj respondsToSelector:sel] — the honest test on an instance, and on a class
// object the only test for a class method. Nothing here is sent on trust: an
// uncaught ObjC exception kills the process with no JavaScript error.
static int menu_has(obj_t obj, const char *selname) {
	if (!obj) return 0;
	return (int)(char)((char (*)(void *, void *, void *))objc_msgSend)(
	    obj, sel_registerName("respondsToSelector:"), sel_registerName(selname));
}

static int menu_has_instance(const char *clsname, const char *selname) {
	void *c = objc_getClass(clsname);
	if (!c) return 0;
	return class_getInstanceMethod(c, sel_registerName(selname)) != 0;
}

// `a` then `b` into C storage: the Quit label is "Quit <app name>", which no
// single string literal can hold.
static void menu_join(char *dst, long cap, const char *a, const char *b) {
	long i = 0;
	while (*a && i < cap - 1) dst[i++] = *a++;
	while (*b && i < cap - 1) dst[i++] = *b++;
	dst[i] = 0;
}

// A submenu. `-initWithTitle:` is the only NSMenu initializer this needs.
static obj_t menu_new(const char *title) {
	if (!menu_has_instance("NSMenu", "initWithTitle:")) return 0;
	obj_t text = menu_nsstring(title, shim_cstr_len(title));
	obj_t allocd = ((obj_t (*)(void *, void *))objc_msgSend)(objc_getClass("NSMenu"),
	                                                        sel_registerName("alloc"));
	if (!text || !allocd) return 0;
	return ((obj_t (*)(void *, void *, obj_t))objc_msgSend)(
	    allocd, sel_registerName("initWithTitle:"), text);
}

// One row, appended to `menu`. A null action and an empty key make a plain item —
// the bar entry that owns a submenu. The target stays nil on every row, which is
// what routes `copy:`/`paste:`/`undo:` to the first responder instead of to crust.
static obj_t menu_row(obj_t menu, const char *title, const char *action_name, const char *key) {
	if (!menu || !menu_has_instance("NSMenuItem", "initWithTitle:action:keyEquivalent:")) return 0;
	if (!menu_has(menu, "addItem:")) return 0;
	obj_t text = menu_nsstring(title, shim_cstr_len(title));
	obj_t equivalent = menu_nsstring(key, shim_cstr_len(key));
	obj_t allocd = ((obj_t (*)(void *, void *))objc_msgSend)(objc_getClass("NSMenuItem"),
	                                                        sel_registerName("alloc"));
	if (!text || !equivalent || !allocd) return 0;
	obj_t action = action_name ? sel_registerName(action_name) : 0;
	obj_t row = ((obj_t (*)(void *, void *, obj_t, obj_t, obj_t))objc_msgSend)(
	    allocd, sel_registerName("initWithTitle:action:keyEquivalent:"), text, action, equivalent);
	if (!row) return 0;
	((void (*)(void *, void *, obj_t))objc_msgSend)(menu, sel_registerName("addItem:"), row);
	return row;
}

// A real separator: an actionless item would render as a disabled row instead.
static int menu_separator(obj_t menu) {
	obj_t cls = objc_getClass("NSMenuItem");
	if (!menu_has(menu, "addItem:") || !menu_has(cls, "separatorItem")) return 0;
	obj_t row = ((obj_t (*)(void *, void *))objc_msgSend)(cls, sel_registerName("separatorItem"));
	if (!row) return 0;
	((void (*)(void *, void *, obj_t))objc_msgSend)(menu, sel_registerName("addItem:"), row);
	return 1;
}

// Give a bar entry the submenu it drops down.
static int menu_attach(obj_t entry, obj_t submenu) {
	if (!menu_has(entry, "setSubmenu:")) return 0;
	((void (*)(void *, void *, obj_t))objc_msgSend)(entry, sel_registerName("setSubmenu:"), submenu);
	return 1;
}

// --- readback --------------------------------------------------------------

static long long menu_count(obj_t menu) {
	if (!menu_has(menu, "numberOfItems")) return -1;
	return ((long long (*)(void *, void *))objc_msgSend)(menu, sel_registerName("numberOfItems"));
}

static obj_t menu_item(obj_t menu, long long index) {
	if (!menu_has(menu, "itemAtIndex:")) return 0;
	return ((obj_t (*)(void *, void *, long long))objc_msgSend)(menu, sel_registerName("itemAtIndex:"),
	                                                            index);
}

// NSString content equality, decided in C: -UTF8String and a byte compare. Never a
// pointer compare — an NSString's identity is not its byte content.
static int menu_key_is(obj_t key, const char *want) {
	if (!menu_has(key, "UTF8String")) return 0;
	const char *got =
	    ((const char *(*)(void *, void *))objc_msgSend)(key, sel_registerName("UTF8String"));
	if (!got) return 0;
	long i = 0;
	while (want[i]) {
		if (got[i] != want[i]) return 0;
		i++;
	}
	return got[i] == 0 ? 1 : 0;
}

// Does any submenu of the installed main menu carry this action with this key
// equivalent? Searched by pair, not by position, so a missing shortcut is named
// as a shortcut rather than as a rearranged menu.
int shim_menu_has(const char *action_name, const char *key) {
	if (!action_name || !key) return 0;
	obj_t app = ((obj_t (*)(void *, void *))objc_msgSend)(objc_getClass("NSApplication"),
	                                                     sel_registerName("sharedApplication"));
	obj_t main_menu = menu_has(app, "mainMenu")
	                      ? ((obj_t (*)(void *, void *))objc_msgSend)(app,
	                                                                  sel_registerName("mainMenu"))
	                      : 0;
	long long entries = menu_count(main_menu);
	for (long long i = 0; i < entries; i++) {
		obj_t entry = menu_item(main_menu, i);
		obj_t submenu = menu_has(entry, "submenu")
		                    ? ((obj_t (*)(void *, void *))objc_msgSend)(entry,
		                                                                sel_registerName("submenu"))
		                    : 0;
		long long rows = menu_count(submenu);
		for (long long j = 0; j < rows; j++) {
			obj_t row = menu_item(submenu, j);
			if (!menu_has(row, "action") || !menu_has(row, "keyEquivalent")) continue;
			obj_t action =
			    ((obj_t (*)(void *, void *))objc_msgSend)(row, sel_registerName("action"));
			if (action != sel_registerName(action_name)) continue;
			obj_t equivalent =
			    ((obj_t (*)(void *, void *))objc_msgSend)(row, sel_registerName("keyEquivalent"));
			if (menu_key_is(equivalent, key)) return 1;
		}
	}
	return 0;
}

// The three shortcuts a human reported dead: ⌘Q, ⌘C, ⌘V. Read without a window and
// without a key press, so a test can assert the menu instead of trusting it.
int shim_menu_ready(void) {
	int quit = shim_menu_has("terminate:", "q");
	int copy = shim_menu_has("copy:", "c");
	int paste = shim_menu_has("paste:", "v");
	return quit && copy && paste ? 1 : 0;
}

// --- install ---------------------------------------------------------------

int shim_menu_install(const char *app_name) {
	if (!app_name || !app_name[0]) return 0;
	obj_t app = ((obj_t (*)(void *, void *))objc_msgSend)(objc_getClass("NSApplication"),
	                                                     sel_registerName("sharedApplication"));
	if (!menu_has(app, "setMainMenu:")) return 0;

	obj_t main_menu = menu_new("");
	obj_t app_menu = menu_new(app_name);
	obj_t edit_menu = menu_new("Edit");
	if (!main_menu || !app_menu || !edit_menu) return 0;

	// The app menu: its bar title is the app's own name, the way a nib builds it,
	// and Quit is the one item that must always be there.
	char quit_label[192];
	menu_join(quit_label, (long)sizeof(quit_label), "Quit ", app_name);
	obj_t app_entry = menu_row(main_menu, app_name, 0, "");
	obj_t quit = menu_row(app_menu, quit_label, "terminate:", "q");
	obj_t edit_entry = menu_row(main_menu, "Edit", 0, "");
	if (!app_entry || !quit || !edit_entry) return 0;
	if (!menu_attach(app_entry, app_menu) || !menu_attach(edit_entry, edit_menu)) return 0;

	// The Edit menu: what makes ⌘C/⌘V reach the focused field or webview. `Z` for
	// Redo is Shift+⌘Z — a capital key equivalent is how AppKit spells the modifier.
	if (!menu_row(edit_menu, "Undo", "undo:", "z")) return 0;
	if (!menu_row(edit_menu, "Redo", "redo:", "Z")) return 0;
	if (!menu_separator(edit_menu)) return 0;
	if (!menu_row(edit_menu, "Cut", "cut:", "x")) return 0;
	if (!menu_row(edit_menu, "Copy", "copy:", "c")) return 0;
	if (!menu_row(edit_menu, "Paste", "paste:", "v")) return 0;
	if (!menu_row(edit_menu, "Select All", "selectAll:", "a")) return 0;

	((void (*)(void *, void *, obj_t))objc_msgSend)(app, sel_registerName("setMainMenu:"),
	                                                main_menu);
	return shim_menu_ready();
}
