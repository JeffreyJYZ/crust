// --- menu api --------------------------------------------------------------
// NSMenu for `crust:menu`. Titles and key equivalents are built and consumed here — a
// short ASCII NSString is a tagged pointer and cannot cross bun:ffi — and a selection
// returns through a runtime class whose IMP is the JSCallback handed to
// menu_api_target: the seam status_bar uses, with the row's `tag` as the index.
// Its own unit, compiled by `menu-api.ts`: never add it to SHIM_PARTS, because these
// statics (`menu_nsstring`, `menu_has`) collide with 55_menu.c's.

typedef void *obj_t;

extern obj_t objc_msgSend(void *self, void *sel, ...);
extern obj_t objc_getClass(const char *name);
extern obj_t sel_registerName(const char *name);
extern void *class_getInstanceMethod(void *cls, void *sel);
extern void *objc_allocateClassPair(void *superclass, const char *name, unsigned long extra);
extern void objc_registerClassPair(void *cls);
extern int class_addMethod(void *cls, void *name, void *imp, const char *types);

typedef struct {
	double x, y, w, h;
} menu_rect;
// NSPoint, built on the C stack: no struct ever crosses bun:ffi.
typedef struct {
	double x, y;
} menu_point;
// Depth 1 is the root an install or a popup uses and a submenu pushes. Fixed, because
// a deeper spec is a caller mistake; static because only -setMainMenu: keeps it alive.
#define MENU_MAX_DEPTH 8
static obj_t menu_stack[MENU_MAX_DEPTH];
static int menu_depth;
static obj_t menu_target_class;
static obj_t menu_target;
static void *menu_imp;
static int menu_responds(obj_t obj, const char *selname) {
	obj_t s = sel_registerName("respondsToSelector:");
	if (!obj || !s) return 0;
	return (int)(char)((char (*)(void *, void *, void *))objc_msgSend)(obj, s,
	                                                                  sel_registerName(selname));
}
static int menu_has(const char *clsname, const char *selname) {
	obj_t c = objc_getClass(clsname);
	obj_t s = sel_registerName(selname);
	return c && s && class_getInstanceMethod(c, s) != 0;
}

// Encoding 4 is UTF-8; `+stringWithUTF8String:` aborts Bun, so alloc plus
// initWithBytes:length:encoding: is the only constructor. Length 0 is the empty title.
static obj_t menu_nsstring(const char *bytes, long long len) {
	if (!bytes || len < 0) return 0;
	obj_t cls = objc_getClass("NSString");
	if (!cls || !menu_responds(cls, "alloc")) return 0;
	obj_t allocated = ((obj_t (*)(void *, void *))objc_msgSend)(cls, sel_registerName("alloc"));
	if (!allocated) return 0;
	return ((obj_t (*)(void *, void *, const char *, unsigned long, long long))objc_msgSend)(
	    allocated, sel_registerName("initWithBytes:length:encoding:"), bytes, (unsigned long)len,
	    4LL);
}
static obj_t menu_app(void) {
	obj_t cls = objc_getClass("NSApplication");
	if (!cls || !menu_responds(cls, "sharedApplication")) return 0;
	return ((obj_t (*)(void *, void *))objc_msgSend)(cls, sel_registerName("sharedApplication"));
}
static obj_t menu_new_menu(obj_t title) {
	if (!menu_has("NSMenu", "initWithTitle:")) return 0;
	obj_t allocated = ((obj_t (*)(void *, void *))objc_msgSend)(objc_getClass("NSMenu"),
	                                                            sel_registerName("alloc"));
	if (!allocated) return 0;
	return ((obj_t (*)(void *, void *, obj_t))objc_msgSend)(
	    allocated, sel_registerName("initWithTitle:"), title);
}
// NSEventModifierFlags from JS; without it AppKit assumes Command alone.
static void menu_mask(obj_t row, int mask) {
	if (!mask || !menu_responds(row, "setKeyEquivalentModifierMask:")) return;
	((void (*)(void *, void *, long long))objc_msgSend)(
	    row, sel_registerName("setKeyEquivalentModifierMask:"), (long long)mask);
}

// One runtime class per process, whose crustMenuSelected: IMP is the JSCallback. The
// instance is static because -[NSMenuItem setTarget:] is unretained.
static int menu_make_target(void) {
	if (menu_target) return 1;
	if (!menu_imp) return 0;
	if (!menu_target_class) {
		obj_t super = objc_getClass("NSObject");
		if (!super) return 0;
		void *cls = objc_allocateClassPair(super, "CrustMenuTarget", 0);
		if (!cls) return 0;
		// "v@:@" — void return, self, _cmd, one object argument.
		if (!class_addMethod(cls, sel_registerName("crustMenuSelected:"), menu_imp, "v@:@"))
			return 0;
		objc_registerClassPair(cls);
		menu_target_class = cls;
	}
	obj_t allocated = ((obj_t (*)(void *, void *))objc_msgSend)(menu_target_class,
	                                                            sel_registerName("alloc"));
	if (!allocated || !menu_responds(allocated, "init")) return 0;
	menu_target = ((obj_t (*)(void *, void *))objc_msgSend)(allocated, sel_registerName("init"));
	return menu_target != 0;
}

int menu_api_target(void *imp) {
	if (!imp) return 0;
	menu_imp = imp;
	return menu_make_target();
}

// A new menu on top of the stack. An abandoned build is dropped here rather than
// tracked: only the next begin can reuse the stack.
int menu_api_begin(void) {
	menu_depth = 0;
	if (!menu_make_target()) return 0;
	obj_t title = menu_nsstring("", 0);
	obj_t menu = title ? menu_new_menu(title) : 0;
	if (!menu) return 0;
	menu_stack[0] = menu;
	menu_depth = 1;
	return 1;
}

// One selectable row: `tag` is the index the click reports.
int menu_api_item(const char *label, long long len, const char *key, long long keylen, int mask,
                  int tag) {
	if (menu_depth < 1) return 0;
	obj_t menu = menu_stack[menu_depth - 1];
	if (!menu || !menu_has("NSMenu", "addItemWithTitle:action:keyEquivalent:")) return 0;
	if (!menu_has("NSMenuItem", "setTarget:") || !menu_has("NSMenuItem", "setTag:")) return 0;
	obj_t title = menu_nsstring(label, len);
	obj_t equivalent = menu_nsstring(key, keylen);
	if (!title || !equivalent) return 0;
	obj_t row = ((obj_t (*)(void *, void *, obj_t, obj_t, obj_t))objc_msgSend)(
	    menu, sel_registerName("addItemWithTitle:action:keyEquivalent:"), title,
	    sel_registerName("crustMenuSelected:"), equivalent);
	if (!row || !menu_responds(row, "setTarget:")) return 0;
	((void (*)(void *, void *, obj_t))objc_msgSend)(row, sel_registerName("setTarget:"),
	                                                menu_target);
	((void (*)(void *, void *, long long))objc_msgSend)(row, sel_registerName("setTag:"),
	                                                    (long long)tag);
	menu_mask(row, mask);
	return 1;
}

// An entry that owns a submenu: no action, so choosing it only opens the menu.
int menu_api_submenu(const char *label, long long len, const char *key, long long keylen,
                     int mask) {
	if (menu_depth < 1 || menu_depth >= MENU_MAX_DEPTH) return 0;
	obj_t menu = menu_stack[menu_depth - 1];
	if (!menu || !menu_has("NSMenu", "addItemWithTitle:action:keyEquivalent:")) return 0;
	if (!menu_has("NSMenu", "setSubmenu:forItem:")) return 0;
	obj_t title = menu_nsstring(label, len);
	obj_t equivalent = menu_nsstring(key, keylen);
	if (!title || !equivalent) return 0;
	obj_t row = ((obj_t (*)(void *, void *, obj_t, obj_t, obj_t))objc_msgSend)(
	    menu, sel_registerName("addItemWithTitle:action:keyEquivalent:"), title, (obj_t)0,
	    equivalent);
	obj_t submenu = row ? menu_new_menu(title) : 0;
	if (!submenu) return 0;
	((void (*)(void *, void *, obj_t, obj_t))objc_msgSend)(
	    menu, sel_registerName("setSubmenu:forItem:"), submenu, row);
	menu_mask(row, mask);
	menu_stack[menu_depth++] = submenu;
	return 1;
}

// A real separator: an actionless row would render as a disabled item instead.
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

// Pop the submenu its children were added to; the root is closed by install or popup.
int menu_api_close(void) {
	if (menu_depth < 2) return 0;
	menu_depth--;
	return 1;
}

// Hand the finished root to NSApplication, which keeps it as the menu bar.
int menu_api_install(void) {
	if (menu_depth != 1) return 0;
	obj_t app = menu_app();
	if (!app || !menu_responds(app, "setMainMenu:")) return 0;
	((void (*)(void *, void *, obj_t))objc_msgSend)(app, sel_registerName("setMainMenu:"),
	                                                menu_stack[0]);
	menu_depth = 0;
	return 1;
}

// The chosen row's index, read from the sender AppKit passes to the IMP.
int menu_api_tag(obj_t sender) {
	if (!sender || !menu_responds(sender, "tag")) return -1;
	return (int)((long long (*)(void *, void *))objc_msgSend)(sender, sel_registerName("tag"));
}
