// --- menu api prelude: the shared statics and constructors -------------------
// Split from 98_menu_api.c at the line cap. Still ONE translation unit with the api, readback and
// context parts — they share the build stack, the runtime target and every static here, plus the
// ownership audit prelude injected by menu-ffi.ts. Never add either part to SHIM_PARTS: menu_nsstring
// and menu_has collide with 55_menu.c's.

typedef void *obj_t;

extern obj_t objc_msgSend(void *self, void *sel, ...);
extern obj_t objc_getClass(const char *name);
extern obj_t sel_registerName(const char *name);
extern void *class_getInstanceMethod(void *cls, void *sel);
extern void *objc_allocateClassPair(void *superclass, const char *name, unsigned long extra);
extern void objc_registerClassPair(void *cls);
extern void objc_disposeClassPair(void *cls);
extern int class_addMethod(void *cls, void *name, void *imp, const char *types);

// Rect and point stay on the C stack: no struct crosses bun:ffi. Depth 1 is the root;
// deeper is a caller mistake, and only -setMainMenu: keeps the root alive.
typedef struct { double x, y, w, h; } menu_rect;
typedef struct { double x, y; } menu_point;
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

// Encoding 4 is UTF-8; alloc + initWithBytes is the only constructor that does not abort Bun.
static obj_t menu_nsstring(const char *bytes, long long len) {
	if (!bytes || len < 0) return 0;
	obj_t cls = objc_getClass("NSString");
	if (!cls || !menu_responds(cls, "alloc")) return 0;
	obj_t allocated = ((obj_t (*)(void *, void *))objc_msgSend)(cls, sel_registerName("alloc"));
	if (!allocated) return 0;
	obj_t title = ((obj_t (*)(void *, void *, const char *, unsigned long, long long))objc_msgSend)(
	    allocated, sel_registerName("initWithBytes:length:encoding:"), bytes, (unsigned long)len,
	    4LL);
	crust_own(title);
	return title;
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
	obj_t menu = ((obj_t (*)(void *, void *, obj_t))objc_msgSend)(
	    allocated, sel_registerName("initWithTitle:"), title);
	crust_own(menu);
	return menu;
}
// NSEventModifierFlags from JS; without it AppKit assumes Command alone.
static void menu_mask(obj_t row, int mask) {
	if (!mask || !menu_responds(row, "setKeyEquivalentModifierMask:")) return;
	((void (*)(void *, void *, long long))objc_msgSend)(
	    row, sel_registerName("setKeyEquivalentModifierMask:"), (long long)mask);
}

// One runtime class per process; its instance is static because setTarget: is unretained.
static int menu_make_target(void) {
	if (menu_target) return 1;
	if (!menu_imp) return 0;
	if (!menu_target_class) {
		obj_t super = objc_getClass("NSObject");
		if (!super) return 0;
		void *cls = objc_allocateClassPair(super, "CrustMenuTarget", 0);
		if (!cls) return 0;
		// "v@:@" — void return, self, _cmd, one object argument. A failed selector disposes the
		// pair: an allocated, unregistered name is invisible to objc_getClass but still occupied.
		if (!class_addMethod(cls, sel_registerName("crustMenuSelected:"), menu_imp, "v@:@")) {
			objc_disposeClassPair(cls); // crustMenuSelected:
			return 0;
		}
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
