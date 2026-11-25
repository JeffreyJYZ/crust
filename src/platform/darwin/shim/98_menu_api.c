// --- menu api: the build and install commands --------------------------------
// Split at the line cap from 98_menu_prelude.c, which owns the shared statics, the target class and
// the +1 constructors. Concatenated into the same translation unit, with crust_release from the
// audit prelude balancing every object the constructors own.

// AppKit retains the installed root, so a rebuild drops crust's +1 before replacing it.
int menu_api_begin(void) {
	menu_depth = 0;
	if (!menu_make_target()) return 0;
	obj_t title = menu_nsstring("", 0);
	obj_t menu = title ? menu_new_menu(title) : 0;
	crust_release(title);
	if (!menu) return 0;
	if (menu_stack[0]) crust_release(menu_stack[0]);
	menu_stack[0] = menu;
	menu_depth = 1;
	return 1;
}

int menu_api_item(const char *label, long long len, const char *key, long long keylen, int mask,
                  int tag) {
	if (menu_depth < 1) return 0;
	obj_t menu = menu_stack[menu_depth - 1];
	if (!menu || !menu_has("NSMenu", "addItemWithTitle:action:keyEquivalent:")) return 0;
	if (!menu_has("NSMenuItem", "setTarget:") || !menu_has("NSMenuItem", "setTag:")) return 0;
	obj_t title = menu_nsstring(label, len);
	obj_t equivalent = menu_nsstring(key, keylen);
	if (!title || !equivalent) {
		crust_release(title);
		crust_release(equivalent);
		return 0;
	}
	obj_t row = ((obj_t (*)(void *, void *, obj_t, obj_t, obj_t))objc_msgSend)(
	    menu, sel_registerName("addItemWithTitle:action:keyEquivalent:"), title,
	    sel_registerName("crustMenuSelected:"), equivalent);
	crust_release(title);
	crust_release(equivalent);
	if (!row || !menu_responds(row, "setTarget:")) return 0;
	((void (*)(void *, void *, obj_t))objc_msgSend)(row, sel_registerName("setTarget:"),
	                                                menu_target);
	((void (*)(void *, void *, long long))objc_msgSend)(row, sel_registerName("setTag:"),
	                                                    (long long)tag);
	menu_mask(row, mask);
	return 1;
}

int menu_api_submenu(const char *label, long long len, const char *key, long long keylen,
                     int mask) {
	if (menu_depth < 1 || menu_depth >= MENU_MAX_DEPTH) return 0;
	obj_t menu = menu_stack[menu_depth - 1];
	if (!menu || !menu_has("NSMenu", "addItemWithTitle:action:keyEquivalent:")) return 0;
	if (!menu_has("NSMenu", "setSubmenu:forItem:")) return 0;
	obj_t title = menu_nsstring(label, len);
	obj_t equivalent = menu_nsstring(key, keylen);
	if (!title || !equivalent) {
		crust_release(title);
		crust_release(equivalent);
		return 0;
	}
	obj_t row = ((obj_t (*)(void *, void *, obj_t, obj_t, obj_t))objc_msgSend)(
	    menu, sel_registerName("addItemWithTitle:action:keyEquivalent:"), title, (obj_t)0,
	    equivalent);
	crust_release(equivalent);
	obj_t submenu = row ? menu_new_menu(title) : 0;
	crust_release(title);
	if (!submenu) return 0;
	((void (*)(void *, void *, obj_t, obj_t))objc_msgSend)(
	    menu, sel_registerName("setSubmenu:forItem:"), submenu, row);
	crust_release(submenu);
	menu_mask(row, mask);
	menu_stack[menu_depth++] = submenu;
	return 1;
}

int menu_api_separator(void) {
	if (menu_depth < 1) return 0;
	obj_t menu = menu_stack[menu_depth - 1];
	obj_t item_class = objc_getClass("NSMenuItem");
	if (!menu || !menu_responds(menu, "addItem:") || !menu_responds(item_class, "separatorItem"))
		return 0;
	obj_t row = ((obj_t (*)(void *, void *))objc_msgSend)(item_class,
	                                                     sel_registerName("separatorItem"));
	if (!row) return 0;
	((void (*)(void *, void *, obj_t))objc_msgSend)(menu, sel_registerName("addItem:"), row);
	return 1;
}

int menu_api_close(void) {
	if (menu_depth < 2) return 0;
	menu_depth--;
	return 1;
}

int menu_api_install(void) {
	if (menu_depth != 1) return 0;
	obj_t app = menu_app();
	if (!app || !menu_responds(app, "setMainMenu:")) return 0;
	((void (*)(void *, void *, obj_t))objc_msgSend)(app, sel_registerName("setMainMenu:"),
	                                                menu_stack[0]);
	menu_depth = 0;
	return 1;
}

int menu_api_tag(obj_t sender) {
	if (!sender || !menu_responds(sender, "tag")) return -1;
	return (int)((long long (*)(void *, void *))objc_msgSend)(sender, sel_registerName("tag"));
}
