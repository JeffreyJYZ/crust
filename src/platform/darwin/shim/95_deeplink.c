// --- deep links ------------------------------------------------------------
// The app delegate that receives a custom-scheme URL, and the two ways one arrives: -application:openURLs: once the app is
// running, and a plain argv element when the binary is launched directly. A bundled app's URL comes as an Apple Event and
// never as argv, so both paths are needed and the last one recorded wins.
// Compiled on its own by `platform/darwin/deep-link.ts`, so it carries its own externs; only an int or a byte count crosses.
// The same delegate also carries the lifecycle callbacks (shim/117_lifecycle.c, concatenated into this unit).

extern void *objc_msgSend(void *self, void *sel, ...);
extern void *objc_getClass(const char *name);
extern void *sel_registerName(const char *name);
extern void *objc_allocateClassPair(void *superclass, const char *name, unsigned long extra);
extern void objc_registerClassPair(void *cls);
extern int class_addMethod(void *cls, void *sel, void *imp, const char *types);

// Defined in shim/117_lifecycle.c, concatenated after this part into one unit.
int crust_lifecycle_add_methods(void *cls);

// macOS caps an Apple Event well below this, and a truncated URL is reported as
// the shorter length, so a caller re-reads rather than trusting a cut string.
#define CRUST_DEEPLINK_CAP 8192

static char crust_deeplink_buffer[CRUST_DEEPLINK_CAP];
static long long crust_deeplink_length = -1; // -1 is "no URL recorded"
static void *crust_deeplink_delegate = 0;

// [obj respondsToSelector:sel] — the only existence test that is safe on an
// instance, and every send below is guarded, because an uncaught ObjC exception
// terminates the process with no JavaScript error.
static int dl_has(void *obj, const char *name) {
	if (!obj) return 0;
	return (int)(char)((char (*)(void *, void *, void *))objc_msgSend)(
	    obj, sel_registerName("respondsToSelector:"), sel_registerName(name));
}

static void dl_store(const char *bytes, long long length) {
	if (!bytes || length < 0) return;
	long long copied = length < CRUST_DEEPLINK_CAP - 1 ? length : CRUST_DEEPLINK_CAP - 1;
	for (long long i = 0; i < copied; i++) crust_deeplink_buffer[i] = bytes[i];
	crust_deeplink_buffer[copied] = 0;
	crust_deeplink_length = copied;
}

static void dl_store_string(void *text) {
	if (!dl_has(text, "UTF8String")) return;
	const char *bytes =
	    ((const char *(*)(void *, void *))objc_msgSend)(text, sel_registerName("UTF8String"));
	if (!bytes) return;
	long long length = 0;
	while (bytes[length]) length++;
	dl_store(bytes, length);
}

// -application:openURLs: — the last URL of the batch wins, because the plugin's
// own `open` replaces the held URL and a page only ever renders one.
static void dl_open_urls(void *self, void *cmd, void *urls) {
	(void)self;
	(void)cmd;
	if (!urls || !dl_has(urls, "count") || !dl_has(urls, "objectAtIndex:")) return;
	long long count =
	    ((long long (*)(void *, void *))objc_msgSend)(urls, sel_registerName("count"));
	if (count <= 0) return;
	void *url = ((void *(*)(void *, void *, long long))objc_msgSend)(
	    urls, sel_registerName("objectAtIndex:"), count - 1);
	if (!dl_has(url, "absoluteString")) return;
	dl_store_string(((void *(*)(void *, void *))objc_msgSend)(url,
	                                                          sel_registerName("absoluteString")));
}

// 0 installed, 1 AppKit is missing a class or selector, 2 there is no shared
// NSApplication yet, 3 the delegate class could not be built, 4 already
// installed, 5 another delegate is already set, 6 a lifecycle method could
// not be added — refusing beats clobbering it, since a replaced delegate
// silently loses whatever else it handled.
int crust_deeplink_install(void) {
	if (crust_deeplink_delegate) return 4;
	void *appCls = objc_getClass("NSApplication");
	if (!appCls || !dl_has(appCls, "sharedApplication")) return 1;
	void *app = ((void *(*)(void *, void *))objc_msgSend)(appCls,
	                                                      sel_registerName("sharedApplication"));
	if (!app) return 2;
	if (!dl_has(app, "setDelegate:") || !dl_has(app, "delegate")) return 1;
	void *current =
	    ((void *(*)(void *, void *))objc_msgSend)(app, sel_registerName("delegate"));
	if (current) return 5;

	void *super = objc_getClass("NSObject");
	void *openSel = sel_registerName("application:openURLs:");
	if (!super || !openSel) return 1;
	void *cls = objc_allocateClassPair(super, "CrustDeepLinkDelegate", 0);
	if (!cls) return 3;
	if (!class_addMethod(cls, openSel, (void *)dl_open_urls, "v@:@")) return 3;
	if (!crust_lifecycle_add_methods(cls)) return 6;
	objc_registerClassPair(cls);
	void *obj = ((void *(*)(void *, void *))objc_msgSend)(cls, sel_registerName("new"));
	if (!obj) return 3;
	// NSApplication's delegate is unretained, so this static is the only reference.
	crust_deeplink_delegate =
	    ((void *(*)(void *, void *))objc_msgSend)(obj, sel_registerName("retain"));
	((void (*)(void *, void *, void *))objc_msgSend)(app, sel_registerName("setDelegate:"),
	                                                 crust_deeplink_delegate);
	return 0;
}

// The recorded URL into `dst`, and its full length so a caller whose buffer was
// too small can ask again with an exact one. -1 is "nothing recorded", which is
// distinct from an empty string, since a real URL is never empty.
long long crust_deeplink_last(char *dst, long long cap) {
	if (!dst || cap <= 0) return -1;
	if (crust_deeplink_length < 0) return -1;
	long long copied = crust_deeplink_length < cap - 1 ? crust_deeplink_length : cap - 1;
	for (long long i = 0; i < copied; i++) dst[i] = crust_deeplink_buffer[i];
	dst[copied] = 0;
	return crust_deeplink_length;
}

void crust_deeplink_clear(void) {
	crust_deeplink_length = -1;
	crust_deeplink_buffer[0] = 0;
}

// RFC 3986 scheme then ':': a letter, then letters, digits, '+', '.' or '-'. At
// least two characters, so a drive letter or a stray "a:" is not a link, and a
// path or a flag can never match because neither starts with a letter.
static int dl_is_url(const char *text) {
	if (!text) return 0;
	char first = text[0];
	if (!((first >= 'a' && first <= 'z') || (first >= 'A' && first <= 'Z'))) return 0;
	for (int i = 1; text[i]; i++) {
		char c = text[i];
		if (c == ':') return i >= 2 ? 1 : 0;
		if ((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') ||
		    c == '+' || c == '.' || c == '-')
			continue;
		return 0;
	}
	return 0;
}

// The cold-launch case: the URL as one argv element. argv[0] is the executable,
// so the scan starts at 1, and the first match replaces anything recorded.
int crust_deeplink_argv(int argc, char **argv) {
	if (!argv || argc <= 1) return 0;
	for (int i = 1; i < argc; i++) {
		if (!dl_is_url(argv[i])) continue;
		long long length = 0;
		while (argv[i][length]) length++;
		dl_store(argv[i], length);
		return 1;
	}
	return 0;
}
