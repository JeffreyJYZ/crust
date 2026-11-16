// --- network: a WKURLSchemeHandler built at runtime -------------------------
// Compiled alone by platform/darwin/network.ts, never joined into the window shim. The shim's
// four rules hold — one fixed prototype per objc_msgSend, no framework header, no object and no
// struct across bun:ffi, and every string built from bytes on this side.
// The handler is one runtime class whose two IMPs are C; the rule decision is a JSCallback that
// answers 1 (allow) or 0 (block). A blocked task gets a real NSError, never an empty body, and an
// allowed one is fetched and delivered here, because WebKit's scheme handler has no pass-through
// and no asynchronous path that avoids a block.

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
static char net_text[NET_TEXT];
static int net_registered;

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
	obj_t request, url, text, data, response, mime;
	long long length;
	int allow;
	(void)self;
	(void)cmd;
	(void)web;
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
	// Synchronous on purpose: this handler has no completion block to resume from, and a block
	// cannot be built here. The fetch is the honest cost of an allowed request.
	data = ((obj_t (*)(void *, void *, obj_t))objc_msgSend)(objc_getClass("NSData"),
	                                                       sel_registerName("dataWithContentsOfURL:"),
	                                                       url);
	if (!data) {
		net_fail(task, NET_BAD_RESPONSE);
		return;
	}
	length = (long long)((unsigned long (*)(void *, void *))objc_msgSend)(data,
	                                                                     sel_registerName("length"));
	mime = net_nsstring("application/octet-stream", 24);
	response = ((obj_t (*)(void *, void *, obj_t, obj_t, long long, obj_t))objc_msgSend)(
	    ((obj_t (*)(void *, void *))objc_msgSend)(objc_getClass("NSURLResponse"),
	                                              sel_registerName("alloc")),
	    sel_registerName("initWithURL:MIMEType:expectedContentLength:textEncodingName:"), url, mime,
	    length, 0);
	if (!response) {
		net_fail(task, NET_BAD_RESPONSE);
		return;
	}
	((void (*)(void *, void *, obj_t))objc_msgSend)(task, sel_registerName("didReceiveResponse:"),
	                                                response);
	((void (*)(void *, void *, obj_t))objc_msgSend)(task, sel_registerName("didReceiveData:"), data);
	((void (*)(void *, void *))objc_msgSend)(task, sel_registerName("didFinish"));
}

// Every answer is sent from inside -startURLSchemeTask:, so a stopped task has nothing to undo.
static void net_stop(void *self, void *cmd, obj_t web, obj_t task) {
	(void)self;
	(void)cmd;
	(void)web;
	(void)task;
}

int net_abi(void) {
	return objc_getClass("NSObject") && objc_getClass("WKWebViewConfiguration") ? 1 : 0;
}

const char *net_url(void) { return net_text; }

int net_installed(void) { return net_registered; }

// Register on a configuration no webview has used yet: WebKit raises for a used one, and a raised
// exception is a SIGABRT with no JavaScript error, so the caller owns that precondition.
int net_install(obj_t configuration, const char *bytes, long len, void *decide) {
	obj_t super, scheme;
	if (!configuration || !decide) return 0;
	net_decide = decide;
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
