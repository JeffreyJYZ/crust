// --- network: a WKURLSchemeHandler built at runtime, part one --------------
// Compiled alone by platform/darwin/network.ts (with `113_network_serve.c` as ONE translation
// unit), never joined into the window shim. The shim's four rules hold — one fixed prototype per
// objc_msgSend, no framework header, no object and no struct across bun:ffi, and every string
// built from bytes on this side.
// This part is the handler class, the decision and the registration; the byte serving is in
// `113_network_serve.c`, which shares this part's statics because the two compile as one unit.

typedef void *obj_t;

extern obj_t objc_msgSend(void *self, void *sel, ...);
extern obj_t objc_getClass(const char *name);
extern obj_t sel_registerName(const char *name);
extern void *objc_allocateClassPair(void *superclass, const char *name, unsigned long extra);
extern void objc_registerClassPair(void *cls);
extern int class_addMethod(void *cls, void *name, void *imp, const char *types);

#define NET_TEXT 2048

// NSURLErrorCancelled and NSURLErrorBadServerResponse, the two the task is failed with.
#define NET_CANCELLED -999
#define NET_BAD_RESPONSE -1011

static obj_t net_handler_class;
static obj_t net_handler;
static void *net_decide;
static void *net_fill;
static char net_text[NET_TEXT];
static int net_registered;

// Defined in `113_network_serve.c`: answer one allowed task with the bytes JavaScript filled.
static int net_serve(obj_t task, obj_t url);

static long net_len(const char *text) {
	long i = 0;
	if (text)
		while (text[i]) i++;
	return i;
}

static void net_copy(const char *text) {
	long i = 0;
	if (!text) {
		net_text[0] = 0;
		return;
	}
	while (text[i] && i < NET_TEXT - 1) {
		net_text[i] = text[i];
		i++;
	}
	net_text[i] = 0;
}

static const char *net_utf8(obj_t text) {
	if (!text) return 0;
	return ((const char *(*)(void *, void *))objc_msgSend)(text, sel_registerName("UTF8String"));
}

static obj_t net_nsstring(const char *bytes, long len) {
	obj_t allocd = ((obj_t (*)(void *, void *))objc_msgSend)(objc_getClass("NSString"),
	                                                        sel_registerName("alloc"));
	if (!allocd) return 0;
	return ((obj_t (*)(void *, void *, const char *, unsigned long, long long))objc_msgSend)(
	    allocd, sel_registerName("initWithBytes:length:encoding:"), bytes, (unsigned long)len, 4LL);
}

// -[WKURLSchemeTask didFailWithError:] with a real NSURLError, so the page sees a failed load.
static void net_fail(obj_t task, long long code) {
	obj_t domain = net_nsstring("NSURLErrorDomain", 16);
	obj_t error;
	if (!domain) return;
	error = ((obj_t (*)(void *, void *, obj_t, long long, obj_t))objc_msgSend)(
	    objc_getClass("NSError"), sel_registerName("errorWithDomain:code:userInfo:"), domain, code,
	    0);
	if (!error) return;
	((void (*)(void *, void *, obj_t))objc_msgSend)(task, sel_registerName("didFailWithError:"),
	                                                error);
}

// webView:startURLSchemeTask: — the whole interception surface.
static void net_start(void *self, void *cmd, obj_t web, obj_t task) {
	obj_t request, url, text;
	int allow;
	(void)self; (void)cmd; (void)web;
	request = ((obj_t (*)(void *, void *))objc_msgSend)(task, sel_registerName("request"));
	url = request ? ((obj_t (*)(void *, void *))objc_msgSend)(request, sel_registerName("URL")) : 0;
	if (!url) {
		net_fail(task, NET_CANCELLED);
		return;
	}
	text = ((obj_t (*)(void *, void *))objc_msgSend)(url, sel_registerName("absoluteString"));
	net_copy(net_utf8(text));
	allow = net_decide ? ((int (*)(void))net_decide)() : 0;
	if (!allow) {
		net_fail(task, NET_CANCELLED);
		return;
	}
	if (!net_serve(task, url)) net_fail(task, NET_BAD_RESPONSE);
}

// Every answer is sent from inside -startURLSchemeTask:, so a stopped task has nothing to undo.
static void net_stop(void *self, void *cmd, obj_t web, obj_t task) {
	(void)self; (void)cmd; (void)web; (void)task;
}

int net_abi(void) {
	return objc_getClass("NSObject") && objc_getClass("WKWebViewConfiguration") ? 1 : 0;
}

// The URL the current decision is about, as a byte range: a cstring return is refused by bun:ffi.
int net_url(char *dst, int cap) {
	int i = 0;
	if (!dst || cap <= 0) return -1;
	while (net_text[i] && i < cap - 1) {
		dst[i] = net_text[i];
		i++;
	}
	dst[i] = 0;
	return i;
}

int net_installed(void) { return net_registered; }

// Register on a configuration no webview has used yet: WebKit raises for a used one, and a raised
// exception is a SIGABRT with no JavaScript error, so the caller owns that precondition.
int net_install(obj_t configuration, const char *bytes, long len, void *decide, void *fill) {
	obj_t super, scheme;
	if (!configuration || !decide || !fill) return 0;
	net_decide = decide;
	net_fill = fill;
	if (!net_handler) {
		super = objc_getClass("NSObject");
		if (!super) return 0;
		net_handler_class = objc_allocateClassPair(super, "CrustSchemeHandler", 0);
		if (!net_handler_class) return 0;
		if (!class_addMethod(net_handler_class, sel_registerName("webView:startURLSchemeTask:"),
		                     (void *)net_start, "v@:@@"))
			return 0;
		if (!class_addMethod(net_handler_class, sel_registerName("webView:stopURLSchemeTask:"),
		                     (void *)net_stop, "v@:@@"))
			return 0;
		objc_registerClassPair(net_handler_class);
		net_handler = ((obj_t (*)(void *, void *))objc_msgSend)(net_handler_class,
		                                                       sel_registerName("alloc"));
		if (!net_handler) return 0;
		net_handler = ((obj_t (*)(void *, void *))objc_msgSend)(net_handler,
		                                                       sel_registerName("init"));
		if (!net_handler) return 0;
	}
	scheme = net_nsstring(bytes, len);
	if (!scheme) return 0;
	((void (*)(void *, void *, obj_t, obj_t))objc_msgSend)(
	    configuration, sel_registerName("setURLSchemeHandler:forURLScheme:"), net_handler, scheme);
	net_registered = 1;
	return 1;
}
