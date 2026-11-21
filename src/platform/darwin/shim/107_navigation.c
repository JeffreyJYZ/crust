// --- navigation: a WKNavigationDelegate built at runtime, part one ----------
// No Objective-C class can be written as a header-free C unit, so the delegate is
// allocated at runtime: objc_allocateClassPair over NSObject, class_addMethod with IMPs
// written here, then objc_setAssociatedObject onto the webview. -navigationDelegate is
// unretained, so the association is the only reference that keeps the object alive and
// lets a second install find it instead of building a second class.
// The sink is a function pointer registered with JSCallback from bun:ffi: a block may not
// cross that boundary, and what it carries is a scalar pair (kind, webview), so the URL and
// title are read back through their own exports in `109_navigation_state.c`.
// Both parts are compiled as ONE translation unit by platform/darwin/navigation-unit.ts,
// the deep-link unit's arrangement, so this half carries the externs and the shared helpers
// and the state half uses them.

typedef void *nav_t;

extern nav_t objc_msgSend(void *self, void *sel, ...);
extern nav_t objc_getClass(const char *name);
extern nav_t sel_registerName(const char *name);
extern nav_t objc_allocateClassPair(void *superclass, const char *name, unsigned long extra);
extern void objc_registerClassPair(void *cls);
extern int class_addMethod(void *cls, void *sel, void *imp, const char *types);
extern void objc_setAssociatedObject(void *object, const void *key, void *value,
                                     unsigned long policy);
extern void *objc_getAssociatedObject(void *object, const void *key);

// The four callbacks as ids: nothing but scalars cross the JSCallback.
#define NAV_START 1
#define NAV_COMMIT 2
#define NAV_FINISH 3
#define NAV_FAIL 4

// OBJC_ASSOCIATION_RETAIN_NONATOMIC.
#define NAV_RETAIN 0x301

#define NAV_ERROR_CAP 512

static int (*nav_sink)(int kind, void *web) = 0;
static char nav_error[NAV_ERROR_CAP];
static char nav_key; // the address is the association key; the value is never read

// [obj respondsToSelector:sel] — the only existence test that is safe on an instance, and
// every send below is guarded, because an uncaught ObjC exception terminates the process
// with no JavaScript error.
static int nav_has(void *obj, const char *name) {
	if (!obj) return 0;
	return (int)(char)((char (*)(void *, void *, void *))objc_msgSend)(
	    obj, sel_registerName("respondsToSelector:"), sel_registerName(name));
}

// An NSString's UTF-8 bytes into `dst`, and its FULL length, so a caller whose buffer was
// too small asks again with an exact one. -1 is "nothing there", which is distinct from an
// empty string.
static long long nav_copy(void *text, char *dst, long long cap) {
	if (!text || !dst || cap <= 0) return -1;
	if (!nav_has(text, "UTF8String")) return -1;
	const char *bytes =
	    ((const char *(*)(void *, void *))objc_msgSend)(text, sel_registerName("UTF8String"));
	if (!bytes) return -1;
	long long length = 0;
	while (bytes[length]) length++;
	long long copied = length < cap - 1 ? length : cap - 1;
	for (long long i = 0; i < copied; i++) dst[i] = bytes[i];
	dst[copied] = 0;
	return length;
}

static void nav_error_set(void *text) {
	nav_error[0] = 0;
	if (text) nav_copy(text, nav_error, NAV_ERROR_CAP);
}

// The NSError a failed navigation carried, as its localizedDescription. Read on the spot,
// because the error object is not ours to keep.
static void nav_error_store(void *error) {
	nav_error[0] = 0;
	if (!error || !nav_has(error, "localizedDescription")) return;
	nav_error_set(((void *(*)(void *, void *))objc_msgSend)(
	    error, sel_registerName("localizedDescription")));
}

static void nav_report(int kind, void *web) {
	if (!nav_sink) return;
	nav_sink(kind, web);
}

// The delegate IMPs. `self` is the delegate and `cmd` the selector; neither is read, and
// the webview is the first argument of each one.
static void nav_did_start(void *self, void *cmd, void *web, void *navigation) {
	(void)self;
	(void)cmd;
	(void)navigation;
	nav_error_set(0);
	nav_report(NAV_START, web);
}

static void nav_did_commit(void *self, void *cmd, void *web, void *navigation) {
	(void)self;
	(void)cmd;
	(void)navigation;
	nav_error_set(0);
	nav_report(NAV_COMMIT, web);
}

static void nav_did_finish(void *self, void *cmd, void *web, void *navigation) {
	(void)self;
	(void)cmd;
	(void)navigation;
	nav_error_set(0);
	nav_report(NAV_FINISH, web);
}

// -webView:didFailNavigation:withError: and its provisional twin, which is the one a load
// that never commits arrives on. Both report did-fail, because a page that failed silently
// is the state this exists to make visible.
static void nav_did_fail(void *self, void *cmd, void *web, void *navigation, void *error) {
	(void)self;
	(void)cmd;
	(void)navigation;
	nav_error_store(error);
	nav_report(NAV_FAIL, web);
}

// The sink, once per process: the JSCallback pointer bun:ffi hands out.
void crust_nav_set_sink(void *sink) { nav_sink = (int (*)(int, void *))sink; }

// The delegate class, built once and reused by every webview. 0 when NSObject is missing or the
// runtime class could not be allocated or filled — which is the only thing that can make an
// install answer 3, so it is also what `crust_nav_class_ready` reports without a window.
static void *nav_class(void) {
	void *cls = objc_getClass("CrustNavigationDelegate");
	if (cls) return cls;
	void *super = objc_getClass("NSObject");
	if (!super) return 0;
	// objc_allocateClassPair answers nil for a name that already exists, which is why the lookup
	// comes first: a second webview reuses the class rather than failing to build one.
	cls = objc_allocateClassPair(super, "CrustNavigationDelegate", 0);
	if (!cls) return 0;
	if (!class_addMethod(cls, sel_registerName("webView:didStartProvisionalNavigation:"),
	                     (void *)nav_did_start, "v@:@@"))
		return 0;
	if (!class_addMethod(cls, sel_registerName("webView:didCommitNavigation:"),
	                     (void *)nav_did_commit, "v@:@@"))
		return 0;
	if (!class_addMethod(cls, sel_registerName("webView:didFinishNavigation:"),
	                     (void *)nav_did_finish, "v@:@@"))
		return 0;
	if (!class_addMethod(cls, sel_registerName("webView:didFailNavigation:withError:"),
	                     (void *)nav_did_fail, "v@:@@@"))
		return 0;
	if (!class_addMethod(cls, sel_registerName("webView:didFailProvisionalNavigation:withError:"),
	                     (void *)nav_did_fail, "v@:@@@"))
		return 0;
	objc_registerClassPair(cls);
	return cls;
}

// 0 installed, 1 no webview or a missing selector, 3 the delegate class could not be built,
// 4 already installed (the association answered), 5 this webview already has a navigation
// delegate that is not ours — refusing beats clobbering a page's own.
int crust_nav_install(void *web) {
	if (!web) return 1;
	if (!nav_has(web, "setNavigationDelegate:")) return 1;
	if (objc_getAssociatedObject(web, &nav_key)) return 4;
	if (!nav_has(web, "navigationDelegate")) return 1;
	void *current = ((void *(*)(void *, void *))objc_msgSend)(web,
	                                                          sel_registerName("navigationDelegate"));
	if (current) return 5;

	void *cls = nav_class();
	if (!cls) return 3;
	void *delegate = ((void *(*)(void *, void *))objc_msgSend)(cls, sel_registerName("new"));
	if (!delegate) return 3;
	// The association is set before the delegate, so the object outlives the unretained
	// -setNavigationDelegate: send.
	objc_setAssociatedObject(web, &nav_key, delegate, NAV_RETAIN);
	((void (*)(void *, void *, void *))objc_msgSend)(web,
	                                                 sel_registerName("setNavigationDelegate:"),
	                                                 delegate);
	return 0;
}

// 1 when a delegate this unit installed was removed, 0 when there was none.
int crust_nav_uninstall(void *web) {
	if (!web) return 0;
	void *delegate = objc_getAssociatedObject(web, &nav_key);
	if (!delegate) return 0;
	if (nav_has(web, "setNavigationDelegate:"))
		((void (*)(void *, void *, void *))objc_msgSend)(web,
		                                                 sel_registerName("setNavigationDelegate:"),
		                                                 0);
	objc_setAssociatedObject(web, &nav_key, 0, NAV_RETAIN);
	// The association's RETAIN is one owner; `[cls new]` at install was a second, +1 owner that
	// clearing the association does not touch. Without this release every surface cycle leaks a
	// CrustNavigationDelegate.
	((void (*)(void *, void *))objc_msgSend)(delegate, sel_registerName("release"));
	return 1;
}
