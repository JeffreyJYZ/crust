// crust macOS status-bar unit — compiled at launch by bun:ffi's cc().
//
// This is the tray half of the AppKit surface, kept in its own translation unit
// so `plugins/tray` can be real without growing shim.c. It obeys the same rules
// as shim.c, each measured (research/cc.md, research/objc.md, DESIGN.md §2):
//
//  1. EVERY objc_msgSend call site casts to a FIXED prototype. A plain
//     `extern void *objc_msgSend(void *, void *, ...)` compiles and runs and
//     delivers wrong argument values with no diagnostic; only zero-argument
//     sends survive it.
//  2. No framework headers. <AppKit/AppKit.h> and <Foundation/Foundation.h> are
//     unreachable from TinyCC with or without -I/-F, so every symbol here is a
//     hand-written extern over void *.
//  3. No object and no struct crosses the export boundary. JS gets an opaque
//     `NSStatusItem *` as a number, ints, and `const char *` out of static
//     storage; a title arrives as an encoded buffer plus its byte length and
//     never as a JS string.
//  4. Nothing here builds an NSString from a short C literal that then leaves
//     C. Titles are built with -initWithBytes:length:encoding: and consumed on
//     this side: a short ASCII NSString is a tagged pointer and cannot survive
//     bun:ffi's number round-trip.
//  5. Menu clicks are a runtime class whose IMP is the JavaScript JSCallback
//     passed to tray_create. `class_addMethod` links and runs (measured); the
//     IMP delivers (id self, SEL _cmd, id sender), and the sender's `tag` is
//     read back through tray_item_index so JS learns which row was clicked.
//     `objc_addMethod` does not exist on this system, `class_addMethod` does.
//
// Every selector is preflighted with class_getInstanceMethod / respondsToSelector:
// before it is sent. An uncaught Objective-C exception is a SIGABRT with no
// JavaScript error, so an absent selector is reported as a 0 return instead.

typedef void *obj_t;

extern obj_t objc_msgSend(void *self, void *sel, ...);
extern obj_t objc_getClass(const char *name);
extern obj_t sel_registerName(const char *name);
extern void *class_getInstanceMethod(void *cls, void *sel);
extern void *class_getClassMethod(void *cls, void *sel);
extern const char *class_getName(void *cls);
extern void *objc_allocateClassPair(void *superclass, const char *name, unsigned long extra);
extern void objc_registerClassPair(void *cls);
extern int class_addMethod(void *cls, void *name, void *imp, const char *types);

// --- guards ----------------------------------------------------------------

// The instance method test: class_getInstanceMethod walks the superclass chain,
// which is what a real `-[NSStatusItem setTitle:]` needs to be found through.
static int tray_has_instance(const char *cls, const char *selname) {
	obj_t c = objc_getClass(cls);
	if (!c) return 0;
	obj_t s = sel_registerName(selname);
	if (!s) return 0;
	return class_getInstanceMethod(c, s) != 0;
}

// The honest test on an instance or a class object alike.
static int tray_responds(obj_t obj, const char *selname) {
	obj_t s = sel_registerName("respondsToSelector:");
	if (!obj || !s) return 0;
	return (int)(char)((char (*)(void *, void *, void *))objc_msgSend)(obj, s,
	                                                                  sel_registerName(selname));
}

// --- strings, entirely inside C --------------------------------------------

// Encoding 4 is NSUTF8StringEncoding. `+stringWithUTF8String:` aborts Bun
// outright, so the measured alloc + initWithBytes pair is the only route.
static obj_t tray_nsstring(const char *bytes, long long len) {
	if (!bytes || len < 0) return 0;
	obj_t cls = objc_getClass("NSString");
	if (!cls || !tray_responds(cls, "alloc")) return 0;
	if (!tray_has_instance("NSPlaceholderString", "initWithBytes:length:encoding:")) return 0;
	obj_t allocated = ((obj_t (*)(void *, void *))objc_msgSend)(cls, sel_registerName("alloc"));
	if (!allocated) return 0;
	return ((obj_t (*)(void *, void *, const char *, unsigned long, long long))objc_msgSend)(
	    allocated, sel_registerName("initWithBytes:length:encoding:"), bytes, (unsigned long)len,
	    4LL);
}

// --- click target ----------------------------------------------------------
//
// One runtime class per process, created on the first menu, whose
// `crustTrayItemClicked:` IMP is the JSCallback status-bar.ts handed to
// tray_create. The instance is kept in static storage because -[NSMenuItem
// setTarget:] is an unretained reference: dropping it would leave every row
// pointing at a deallocated object.
static void *tray_target_class;
static obj_t tray_target;
static void *tray_click_imp;

static int tray_make_target(void) {
	if (tray_target) return 1;
	if (!tray_click_imp) return 0;
	if (!tray_target_class) {
		obj_t super = objc_getClass("NSObject");
		if (!super) return 0;
		void *cls = objc_allocateClassPair(super, "CrustStatusTrayTarget", 0);
		if (!cls) return 0;
		// "v@:@" — void return, self, _cmd, one object argument.
		if (!class_addMethod(cls, sel_registerName("crustTrayItemClicked:"), tray_click_imp,
		                     "v@:@")) {
			return 0;
		}
		objc_registerClassPair(cls);
		tray_target_class = cls;
	}
	obj_t allocated = ((obj_t (*)(void *, void *))objc_msgSend)(tray_target_class,
	                                                            sel_registerName("alloc"));
	if (!allocated) return 0;
	if (!tray_responds(allocated, "init")) return 0;
	tray_target = ((obj_t (*)(void *, void *))objc_msgSend)(allocated, sel_registerName("init"));
	return tray_target != 0;
}

// --- status item -----------------------------------------------------------

// Compile/link round-trip for the test suite: proves AppKit really links here
// the way NSHomeDirectory proves Foundation links in research/cc.md.
int tray_abi(void) { return 1; }

// The status item, sized to its content. `imp` is the JavaScript callback that
// becomes the menu target's IMP; a menu is only usable when it is non-null.
// Returns 0 when NSStatusBar or a selector it needs is absent, never a crash.
obj_t tray_create(void *imp) {
	if (!imp) return 0;
	tray_click_imp = imp;

	obj_t bar_cls = objc_getClass("NSStatusBar");
	if (!bar_cls) return 0;
	if (!tray_responds(bar_cls, "systemStatusBar")) return 0;
	if (!tray_has_instance("NSStatusBar", "statusItemWithLength:")) return 0;
	obj_t bar = ((obj_t (*)(void *, void *))objc_msgSend)(bar_cls,
	                                                     sel_registerName("systemStatusBar"));
	if (!bar) return 0;

	// NSVariableStatusItemLength is -1.0: the item sizes itself to its content.
	obj_t item = ((obj_t (*)(void *, void *, double))objc_msgSend)(
	    bar, sel_registerName("statusItemWithLength:"), -1.0);
	return item ? item : 0;
}

// The title, built and applied on this side. `-[NSStatusItem title]` exists on
// 10.12+, and the button is the older surface; whichever is present is used and
// the applied title is read back by tray_title_copy, so a silent no-op is
// visible to JS instead of looking like success.
int tray_set_title(obj_t item, const char *bytes, long long len) {
	if (!item) return 0;
	obj_t title = tray_nsstring(bytes, len);
	if (!title) return 0;

	if (tray_has_instance("NSStatusItem", "setTitle:")) {
		((void (*)(void *, void *, obj_t))objc_msgSend)(item, sel_registerName("setTitle:"),
		                                                title);
		return 1;
	}
	if (!tray_has_instance("NSStatusItem", "button")) return 0;
	obj_t button = ((obj_t (*)(void *, void *))objc_msgSend)(item, sel_registerName("button"));
	if (!button || !tray_responds(button, "setTitle:")) return 0;
	((void (*)(void *, void *, obj_t))objc_msgSend)(button, sel_registerName("setTitle:"), title);
	return 1;
}

#define TRAY_TITLE_BYTES 512
static char tray_title_buf[TRAY_TITLE_BYTES];

// The size of the readback buffer, so JS knows when a comparison is meaningful.
int tray_title_capacity(void) { return TRAY_TITLE_BYTES; }

static obj_t tray_status_title(obj_t item) {
	if (tray_has_instance("NSStatusItem", "title")) {
		obj_t title = ((obj_t (*)(void *, void *))objc_msgSend)(item, sel_registerName("title"));
		if (title) return title;
	}
	if (!tray_has_instance("NSStatusItem", "button")) return 0;
	obj_t button = ((obj_t (*)(void *, void *))objc_msgSend)(item, sel_registerName("button"));
	if (!button || !tray_responds(button, "title")) return 0;
	return ((obj_t (*)(void *, void *))objc_msgSend)(button, sel_registerName("title"));
}

// The applied title copied into static storage: a `const char *` return, never
// an NSString across the boundary. Bounded by TRAY_TITLE_BYTES.
const char *tray_title_copy(obj_t item) {
	tray_title_buf[0] = 0;
	if (!item) return tray_title_buf;
	obj_t title = tray_status_title(item);
	if (!title || !tray_responds(title, "UTF8String")) return tray_title_buf;
	const char *utf8 = ((const char *(*)(void *, void *))objc_msgSend)(title,
	                                                                  sel_registerName("UTF8String"));
	if (!utf8) return tray_title_buf;
	long i = 0;
	while (utf8[i] && i < TRAY_TITLE_BYTES - 1) {
		tray_title_buf[i] = utf8[i];
		i++;
	}
	tray_title_buf[i] = 0;
	return tray_title_buf;
}

// Show or hide the item. `-[NSStatusItem setVisible:]` is the only supported
// route; an absent selector is a 0, and status-bar.ts turns that into a typed
// failure rather than pretending the item moved.
int tray_set_visible(obj_t item, int visible) {
	if (!item) return 0;
	if (!tray_has_instance("NSStatusItem", "setVisible:")) return 0;
	((void (*)(void *, void *, int))objc_msgSend)(item, sel_registerName("setVisible:"),
	                                              visible ? 1 : 0);
	return 1;
}

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

// The clicked row's index, read from the sender AppKit passes to the IMP.
int tray_item_index(obj_t sender) {
	if (!sender || !tray_responds(sender, "tag")) return -1;
	return (int)((long long (*)(void *, void *))objc_msgSend)(sender, sel_registerName("tag"));
}

// --- teardown --------------------------------------------------------------

// Remove the item from the menu bar. The runtime class and its target stay
// alive for the process: a later status bar reuses the same click IMP, and a
// freed trampoline behind a live object is a SIGABRT.
void tray_destroy(obj_t item) {
	if (!item) return;
	tray_building_menu = 0;
	obj_t bar_cls = objc_getClass("NSStatusBar");
	if (!bar_cls || !tray_responds(bar_cls, "systemStatusBar")) return;
	if (!tray_has_instance("NSStatusBar", "removeStatusItem:")) return;
	obj_t bar = ((obj_t (*)(void *, void *))objc_msgSend)(bar_cls,
	                                                     sel_registerName("systemStatusBar"));
	if (!bar) return;
	((void (*)(void *, void *, obj_t))objc_msgSend)(bar, sel_registerName("removeStatusItem:"),
	                                                item);
}
