// --- click target ----------------------------------------------------------
// One runtime class per process, created on the first menu, whose
// `crustTrayItemClicked:` IMP is the JSCallback status-bar.ts handed to
// tray_create. The instance lives in static storage because -[NSMenuItem
// setTarget:] is an unretained reference: dropping it leaves every row
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

