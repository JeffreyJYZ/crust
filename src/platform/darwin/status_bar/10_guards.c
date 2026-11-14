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

