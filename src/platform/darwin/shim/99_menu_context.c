// --- menu api, context menu ------------------------------------------------
// Part 2 of `98_menu_api.c`, concatenated into that unit so it shares the build
// stack, the runtime target and the guards: it compiles nowhere alone.

// The one bar crust installed as the default (55_menu.c at startup, `reset()` after a caller
// rebuilt the menu). Identity, not shape: a caller can build two roots titled after the app and
// claim the default name, but its NSMenu pointer is never the one this records.
void menu_api_mark_default(void) {
	obj_t app = menu_app();
	if (!app || !menu_responds(app, "mainMenu")) return;
	menu_default_bar = ((obj_t (*)(void *, void *))objc_msgSend)(app,
	                                                             sel_registerName("mainMenu"));
}

// A context menu on the key window's content view. A page's y grows downward and an
// unflipped NSView's grows up, so y is flipped about the content view's frame height;
// x needs no scaling, because one CSS pixel is one point at scale 1.
int menu_api_popup(double x, double y) {
	if (menu_depth != 1) return 0;
	obj_t app = menu_app();
	if (!app || !menu_responds(app, "keyWindow")) return 0;
	obj_t window = ((obj_t (*)(void *, void *))objc_msgSend)(app, sel_registerName("keyWindow"));
	if (!window || !menu_responds(window, "contentView")) return 0;
	obj_t view = ((obj_t (*)(void *, void *))objc_msgSend)(window, sel_registerName("contentView"));
	if (!view || !menu_responds(view, "frame")) return 0;
	menu_rect frame = ((menu_rect (*)(void *, void *))objc_msgSend)(view,
	                                                               sel_registerName("frame"));
	menu_point at = {x, frame.h - y};
	obj_t menu = menu_stack[0];
	if (!menu_responds(menu, "popUpMenuPositioningItem:atLocation:inView:")) return 0;
	int shown = (int)(char)((char (*)(void *, void *, obj_t, menu_point, obj_t))objc_msgSend)(
	    menu, sel_registerName("popUpMenuPositioningItem:atLocation:inView:"), (obj_t)0, at, view);
	menu_depth = 0;
	return shown;
}
