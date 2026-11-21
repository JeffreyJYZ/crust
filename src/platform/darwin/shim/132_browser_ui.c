// --- browser: capture denied, new windows refused, popups reported ----------
// Second of two parts, joined after `131_browser.c` into one translation unit. Both policies live
// in ONE `WKUIDelegate` because a webview has exactly one and a second install would either clobber
// the first or be refused:
//   - media capture is denied, always. An unimplemented delegate behaves as "prompt", and a TCC
//     request from a bundle with no microphone purpose string terminates the process — so a remote
//     page must never be able to ask through the app's own signed binary.
//   - a new webview (`target=_blank`, `window.open`) is refused by returning nil, and its URL is
//     reported to JavaScript so `crust:browser` can hand it to the system opener instead.
// The surface carries no bridge token at all: the plugin builds it from a fresh configuration with
// no user scripts, so `window.crust` does not exist there.

extern br_t objc_allocateClassPair(void *superclass, const char *name, unsigned long extra);
extern void objc_registerClassPair(void *cls);
extern int class_addMethod(void *cls, void *sel, void *imp, const char *types);
extern void objc_setAssociatedObject(void *object, const void *key, void *value,
                                     unsigned long policy);
extern void *objc_getAssociatedObject(void *object, const void *key);

// WKPermissionDecision: 0 prompt, 1 grant, 2 deny. A browser surface never grants.
#define BR_DENY 2
// OBJC_ASSOCIATION_RETAIN_NONATOMIC.
#define BR_RETAIN 0x301
// The prefix of a block's 64-bit layout: the invoke pointer is the fourth word. WebKit owns the
// block and it stays valid for the duration of the method.
typedef struct {
	void *isa;
	int flags;
	int reserved;
	void (*invoke)(void *, long long);
} br_decision_t;

#define BR_POPUP_CAP 2048

// The one sink a refused new window is reported through; a block may not cross bun:ffi, so the URL
// is read back through `shim_browser_popup_url`.
static int (*br_sink)(int count, void *web) = 0;
static char br_popup[BR_POPUP_CAP];
static int br_popups;
static char br_key; // the address is the association key; the value is never read

static void br_decide(br_t self, br_t cmd, br_t web, br_t origin, br_t frame, long long type,
                      br_t decision) {
	(void)self;
	(void)cmd;
	(void)web;
	(void)origin;
	(void)frame;
	(void)type;
	if (!decision) return;
	br_decision_t *handler = (br_decision_t *)decision;
	if (!handler->invoke) return;
	handler->invoke(decision, (long long)BR_DENY);
}

// `action.request.URL.absoluteString` into `br_popup`; an action with no URL leaves it empty.
static void br_record_popup(br_t action) {
	br_popup[0] = 0;
	if (!action || !br_has(action, "request")) return;
	br_t request = br_msg0(action, "request");
	if (!request || !br_has(request, "URL")) return;
	br_t url = br_msg0(request, "URL");
	if (!url || !br_has(url, "absoluteString")) return;
	br_copy(br_msg0(url, "absoluteString"), br_popup, BR_POPUP_CAP);
}

// Returning nil is the refusal: WebKit creates no second webview, and the URL goes to JavaScript.
static br_t br_new_window(br_t self, br_t cmd, br_t web, br_t configuration, br_t action,
                          br_t features) {
	(void)self;
	(void)cmd;
	(void)configuration;
	(void)features;
	br_record_popup(action);
	br_popups++;
	if (br_sink) br_sink(br_popups, web);
	return 0;
}

static br_t br_delegate_class(void) {
	br_t cls = objc_getClass("CrustBrowserUIDelegate");
	if (cls) return cls;
	br_t super = objc_getClass("NSObject");
	if (!super) return 0;
	cls = objc_allocateClassPair(super, "CrustBrowserUIDelegate", 0);
	if (!cls) return 0;
	if (!class_addMethod(cls,
	                     sel_registerName("webView:requestMediaCapturePermissionForOrigin:"
	                                      "initiatedByFrame:type:decisionHandler:"),
	                     (void *)br_decide, "v@:@@@q@"))
		return 0;
	if (!class_addMethod(cls,
	                     sel_registerName("webView:createWebViewWithConfiguration:"
	                                      "forNavigationAction:windowFeatures:"),
	                     (void *)br_new_window, "@@:@@@@"))
		return 0;
	objc_registerClassPair(cls);
	return cls;
}

// 0 installed, 1 no webview or a missing selector, 3 the delegate class could not be built,
// 4 already installed, 5 another UI delegate owns the webview — refusing beats clobbering it.
int shim_browser_ui_install(void *web) {
	br_t view = web;
	if (!view) return 1;
	if (!br_has(view, "setUIDelegate:")) return 1;
	if (objc_getAssociatedObject(view, &br_key)) return 4;
	if (!br_has(view, "UIDelegate")) return 1;
	br_t current = br_msg0(view, "UIDelegate");
	if (current) return 5;

	br_t cls = br_delegate_class();
	if (!cls) return 3;
	br_t delegate = br_msg0(cls, "new");
	if (!delegate) return 3;
	// The association is set before the delegate, so the object outlives the unretained
	// `-setUIDelegate:` send.
	objc_setAssociatedObject(view, &br_key, delegate, BR_RETAIN);
	((void (*)(void *, void *, br_t))objc_msgSend)(view, sel_registerName("setUIDelegate:"),
	                                               delegate);
	return 0;
}

int shim_browser_ui_installed(void *web) {
	if (!web) return 0;
	return objc_getAssociatedObject(web, &br_key) ? 1 : 0;
}

void shim_browser_set_sink(void *sink) { br_sink = (int (*)(int, void *))sink; }

int shim_browser_popups(void) { return br_popups; }

long long shim_browser_popup_url(char *dst, long long cap) {
	if (!dst || cap <= 0) return 0;
	long long length = 0;
	while (br_popup[length]) length++;
	long long copied = length < cap - 1 ? length : cap - 1;
	for (long long i = 0; i < copied; i++) dst[i] = br_popup[i];
	dst[copied] = 0;
	return length;
}

// WKPermissionDecisionDeny: 2. Exported so the proof reads the policy back rather than trusting
// that a method body contains the number it was written with.
int shim_browser_capture_decision(void) { return BR_DENY; }
