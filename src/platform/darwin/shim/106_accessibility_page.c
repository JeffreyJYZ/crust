// --- accessibility: page-facing announcement surface, beside 106_accessibility.c --
// Compiled by accessibility-page-ffi.ts; no header, every symbol a hand-written extern. No NSString
// leaves C (a short one is a tagged pointer that cannot cross bun:ffi), and a window is resolved here
// because the plugin has no platform instance: key window, else first, else the named one.
// Announcement keys use __CFStringMakeConstantString, not AppKit's key externs: AppKit compares the
// dictionary by string equality, so "AXAnnouncement"/"AXPriority" is the whole contract.

typedef void *ax_t;
typedef void *obj_t;

extern obj_t objc_msgSend(void *self, void *sel, ...);
extern obj_t objc_getClass(const char *name);
extern obj_t sel_registerName(const char *name);
extern obj_t class_getInstanceMethod(void *cls, void *sel);
extern obj_t __CFStringMakeConstantString(const char *cstr);
extern ax_t CFDictionaryCreate(ax_t alloc, const void **keys, const void **values, long count,
                               const void *key_callbacks, const void *value_callbacks);
extern void CFRelease(ax_t cf);
extern long CFArrayGetCount(ax_t array);
extern ax_t CFArrayGetValueAtIndex(ax_t array, long index);
extern ax_t AXUIElementCreateApplication(int pid);
extern int AXUIElementCopyAttributeValue(ax_t element, ax_t attribute, ax_t *value);
extern int AXUIElementSetAttributeValue(ax_t element, ax_t attribute, ax_t value);
extern ax_t kCFBooleanTrue;
extern void NSAccessibilityPostNotificationWithUserInfo(ax_t element, ax_t notification,
                                                        ax_t user_info);
extern int getpid(void);

#define AX_OK 0

// A local byte length, because this unit is compiled alone: `shim_cstr_len` lives in the AppKit shim,
// a different compilation unit, and referencing it here is an unresolved symbol at `cc()` time.
static long ax_len(const char *text) {
	long n = 0;
	while (text && text[n]) n++;
	return n;
}

static int ax_same(const char *left, const char *right) {
	if (!left || !right) return 0;
	long i = 0;
	while (left[i] && left[i] == right[i]) i++;
	return left[i] == 0 && right[i] == 0;
}

// A JS string arrives as a NUL-terminated byte buffer; the NSString is built and stays native-side.
static obj_t ax_nsstring(const char *text) {
	obj_t allocated = ((obj_t (*)(void *, void *))objc_msgSend)(objc_getClass("NSString"),
	                                                           sel_registerName("alloc"));
	if (!allocated) return 0;
	obj_t string = ((obj_t (*)(void *, void *, const char *, unsigned long, long long))objc_msgSend)(
	    allocated, sel_registerName("initWithBytes:length:encoding:"), text,
	    (unsigned long)ax_len(text), 4LL);
	crust_own(string);
	return string;
}

// Ownership follows 00_audit.c: crust_own when ax_nsstring builds the +1, crust_release after the
// AppKit send that copies it; CF objects use crust_cf_own / crust_cf_release. Focus lives in the
// adjacent 106_accessibility_focus.c part, concatenated after this one.

static const char *ax_utf8(obj_t string) {
	if (!string) return 0;
	return ((const char *(*)(void *, void *))objc_msgSend)(string, sel_registerName("UTF8String"));
}

static int ax_responds(obj_t obj, const char *sel) {
	if (!obj) return 0;
	return class_getInstanceMethod(((obj_t (*)(void *, void *))objc_msgSend)(
	                                  obj, sel_registerName("class")),
	                              sel_registerName(sel)) != 0;
}

// One window: an empty label is the key window (what a screen reader is on), else the first whose
// title or accessible label the caller named, else — for an empty-list app — nothing.
static obj_t ax_window(const char *label) {
	obj_t app = ((obj_t (*)(void *, void *))objc_msgSend)(objc_getClass("NSApplication"),
	                                                      sel_registerName("sharedApplication"));
	if (!app) return 0;
	obj_t list = ((obj_t (*)(void *, void *))objc_msgSend)(app, sel_registerName("windows"));
	if (!list) return 0;
	long n = CFArrayGetCount(list);
	if (n <= 0) return 0;
	if (!label || !label[0]) {
		obj_t key = ((obj_t (*)(void *, void *))objc_msgSend)(app,
		                                                     sel_registerName("keyWindow"));
		return key ? key : CFArrayGetValueAtIndex(list, 0);
	}
	for (long i = 0; i < n; i++) {
		obj_t window = CFArrayGetValueAtIndex(list, i);
		if (ax_same(label, ax_utf8(((obj_t (*)(void *, void *))objc_msgSend)(
		                     window, sel_registerName("title")))))
			return window;
		if (!ax_responds(window, "accessibilityLabel")) continue;
		obj_t name = ((obj_t (*)(void *, void *))objc_msgSend)(window,
		                                                      sel_registerName("accessibilityLabel"));
		if (ax_same(label, ax_utf8(name))) return window;
	}
	return 0;
}

// 1 when the announcement was posted, 0 when the dictionary could not be built. A process that is not
// trusted still posts here: AppKit takes the post and the OS decides whether anything is spoken, so
// the caller reports the trust state beside this answer instead of calling an untrusted post a failure.
int crust_ax_announce(const char *text, int assertive) {
	if (!text || !text[0]) return 0;
	obj_t message = ax_nsstring(text);
	if (!message) return 0;
	// NSAccessibilityPriorityHigh = 90, NSAccessibilityPriorityMedium = 50.
	obj_t priority = ((obj_t (*)(void *, void *, long long))objc_msgSend)(
	    objc_getClass("NSNumber"), sel_registerName("numberWithInteger:"), assertive ? 90LL : 50LL);
	if (!priority) {
		crust_release(message);
		return 0;
	}
	ax_t keys[2];
	ax_t values[2];
	keys[0] = __CFStringMakeConstantString("AXAnnouncement");
	values[0] = message;
	keys[1] = __CFStringMakeConstantString("AXPriority");
	values[1] = priority;
	ax_t info = CFDictionaryCreate(0, (const void **)keys, (const void **)values, 2, 0, 0);
	// The dictionary retains its values; our +1 message ends here on both the success and the
	// nil-dictionary path. priority is +0 from numberWithInteger: and stays with the pool.
	crust_cf_own(info);
	if (!info) {
		crust_release(message);
		return 0;
	}
	ax_t app = AXUIElementCreateApplication(getpid());
	crust_cf_own(app);
	if (!app) {
		crust_cf_release(info);
		crust_release(message);
		return 0;
	}
	NSAccessibilityPostNotificationWithUserInfo(
	    app, __CFStringMakeConstantString("AXAnnouncementRequested"), info);
	crust_cf_release(info);
	crust_cf_release(app);
	crust_release(message);
	return 1;
}

// The window's accessible name: `-setAccessibilityLabel:` is the string VoiceOver reads on focus, and
// it is separate from `-setTitle:`, which is the visible title and stays untouched.
int crust_ax_title(const char *text, const char *label) {
	if (!text || !text[0]) return 0;
	obj_t window = ax_window(label);
	if (!window || !ax_responds(window, "setAccessibilityLabel:")) return 0;
	obj_t name = ax_nsstring(text);
	if (!name) return 0;
	((void (*)(void *, void *, obj_t))objc_msgSend)(window,
	                                                sel_registerName("setAccessibilityLabel:"), name);
	crust_release(name);
	return 1;
}
