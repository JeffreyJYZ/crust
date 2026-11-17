// --- navigation: state, history and the webview lookup, part two -----------
// Compiled as ONE translation unit with `107_navigation.c` by
// platform/darwin/navigation-unit.ts, so `nav_has`, `nav_copy` and `nav_error` are this
// half's helpers too. Nothing here crosses a struct: every read is a scalar or a byte range,
// and the webview pointer itself stays an opaque number.
// `-canGoBack`/`-canGoForward` are read before the history send, because `-goBack` on an
// empty history is a silent no-op and answering "moved" for it would report a page the user
// never reached.

// -[WKWebView URL] → -[NSURL absoluteString]; -1 when the webview has no URL yet.
long long crust_nav_url(void *web, char *dst, long long cap) {
	if (!nav_has(web, "URL")) return -1;
	void *url = ((void *(*)(void *, void *))objc_msgSend)(web, sel_registerName("URL"));
	if (!url) return -1;
	if (!nav_has(url, "absoluteString")) return -1;
	return nav_copy(
	    ((void *(*)(void *, void *))objc_msgSend)(url, sel_registerName("absoluteString")), dst, cap);
}

// -[WKWebView title], which is empty until the document has a title; -1 for a webview that
// cannot answer at all.
long long crust_nav_title(void *web, char *dst, long long cap) {
	if (!nav_has(web, "title")) return -1;
	return nav_copy(((void *(*)(void *, void *))objc_msgSend)(web, sel_registerName("title")), dst,
	                cap);
}

// The NSError the last failed navigation carried, and its full length.
long long crust_nav_error(char *dst, long long cap) {
	if (!dst || cap <= 0) return -1;
	long long length = 0;
	while (nav_error[length]) length++;
	long long copied = length < cap - 1 ? length : cap - 1;
	for (long long i = 0; i < copied; i++) dst[i] = nav_error[i];
	dst[copied] = 0;
	return length;
}

int crust_nav_loading(void *web) {
	if (!nav_has(web, "isLoading")) return 0;
	return (int)(char)((char (*)(void *, void *))objc_msgSend)(web, sel_registerName("isLoading"));
}

int crust_nav_can_go_back(void *web) {
	if (!nav_has(web, "canGoBack")) return 0;
	return (int)(char)((char (*)(void *, void *))objc_msgSend)(web, sel_registerName("canGoBack"));
}

int crust_nav_can_go_forward(void *web) {
	if (!nav_has(web, "canGoForward")) return 0;
	return (int)(char)((char (*)(void *, void *))objc_msgSend)(web,
	                                                           sel_registerName("canGoForward"));
}

// 1 when the send ran, 0 when the webview cannot answer it.
int crust_nav_reload(void *web) {
	if (!nav_has(web, "reload")) return 0;
	((void (*)(void *, void *))objc_msgSend)(web, sel_registerName("reload"));
	return 1;
}

// Start a load from a URL string. Two steps that can each fail, so each is checked: an NSURL the
// class cannot parse is not a load, and an NSURLRequest needs `-initWithURL:`. Butter scrolls its
// own JSON at this point; this stays in C because a string crossing bun:ffi would have to come back
// as an object to build the request.
int crust_nav_load_url(void *web, const char *bytes, long long len) {
	if (!web || !bytes || len <= 0) return 0;
	if (!nav_has(web, "loadRequest:")) return 0;

	void *strCls = objc_getClass("NSString");
	if (!strCls || !nav_has(strCls, "alloc")) return 0;
	void *allocStr = ((void *(*)(void *, void *))objc_msgSend)(strCls, sel_registerName("alloc"));
	if (!allocStr) return 0;
	void *text = ((void *(*)(void *, void *, const char *, unsigned long,
	                         long long))objc_msgSend)(
	    allocStr, sel_registerName("initWithBytes:length:encoding:"), bytes, (unsigned long)len,
	    4LL);
	if (!text) return 0;

	void *urlCls = objc_getClass("NSURL");
	if (!urlCls || !nav_has(urlCls, "URLWithString:")) return 0;
	void *url = ((void *(*)(void *, void *, void *))objc_msgSend)(urlCls,
	                                                             sel_registerName("URLWithString:"),
	                                                             text);
	if (!url) return 0;

	void *reqCls = objc_getClass("NSURLRequest");
	if (!reqCls || !nav_has(reqCls, "alloc")) return 0;
	void *allocReq = ((void *(*)(void *, void *))objc_msgSend)(reqCls, sel_registerName("alloc"));
	if (!allocReq) return 0;
	if (!nav_has(allocReq, "initWithURL:")) return 0;
	void *request = ((void *(*)(void *, void *, void *))objc_msgSend)(allocReq,
	                                                                  sel_registerName("initWithURL:"),
	                                                                  url);
	if (!request) return 0;

	((void (*)(void *, void *, void *))objc_msgSend)(web, sel_registerName("loadRequest:"), request);
	return 1;
}

int crust_nav_go_back(void *web) {
	if (!crust_nav_can_go_back(web)) return 0;
	((void (*)(void *, void *))objc_msgSend)(web, sel_registerName("goBack"));
	return 1;
}

int crust_nav_go_forward(void *web) {
	if (!crust_nav_can_go_forward(web)) return 0;
	((void (*)(void *, void *))objc_msgSend)(web, sel_registerName("goForward"));
	return 1;
}

// The WKWebView inside an NSWindow, so a caller holding only the window pointer the platform
// already exposes can reach it: -contentView's first subview that is a WKWebView. 0 when the
// window has none.
void *crust_nav_webview(void *window) {
	if (!nav_has(window, "contentView")) return 0;
	void *content = ((void *(*)(void *, void *))objc_msgSend)(window,
	                                                          sel_registerName("contentView"));
	if (!content || !nav_has(content, "subviews")) return 0;
	void *list = ((void *(*)(void *, void *))objc_msgSend)(content, sel_registerName("subviews"));
	if (!list) return 0;
	void *cls = objc_getClass("WKWebView");
	if (!cls) return 0;
	long long count =
	    ((long long (*)(void *, void *))objc_msgSend)(list, sel_registerName("count"));
	for (long long i = 0; i < count; i++) {
		void *view = ((void *(*)(void *, void *, long long))objc_msgSend)(
		    list, sel_registerName("objectAtIndex:"), i);
		if (!view || !nav_has(view, "isKindOfClass:")) continue;
		if ((char)((char (*)(void *, void *, void *))objc_msgSend)(
		        view, sel_registerName("isKindOfClass:"), cls))
			return view;
	}
	return 0;
}

// +[cls instancesRespondToSelector:] — whether the runtime class really carries a method, which
// is the half a `class_addMethod` failure would otherwise only show on a live navigation.
static int nav_class_has(void *cls, const char *name) {
	if (!nav_has(cls, "instancesRespondToSelector:")) return 0;
	return (int)(char)((char (*)(void *, void *, void *))objc_msgSend)(
	    cls, sel_registerName("instancesRespondToSelector:"), sel_registerName(name));
}

// A bitmask of the five callbacks the delegate carries, 31 for all of them. Proven without a
// window: the class is built here, so a suite can assert the runtime delegate before any
// navigation happens, and a missing method is a number rather than a silent callback that never
// fires.
int crust_nav_class_ready(void) {
	void *cls = nav_class();
	if (!cls) return 0;
	int mask = 0;
	if (nav_class_has(cls, "webView:didStartProvisionalNavigation:")) mask |= 1;
	if (nav_class_has(cls, "webView:didCommitNavigation:")) mask |= 2;
	if (nav_class_has(cls, "webView:didFinishNavigation:")) mask |= 4;
	if (nav_class_has(cls, "webView:didFailNavigation:withError:")) mask |= 8;
	if (nav_class_has(cls, "webView:didFailProvisionalNavigation:withError:")) mask |= 16;
	return mask;
}
