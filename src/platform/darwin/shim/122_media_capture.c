// --- media capture: the UI delegate's permission decision -------------------
// `getUserMedia` is live in every WKWebView on the supported systems: the public API has no
// configuration switch, and `WKUIDelegate.h` says an unimplemented
// -webView:requestMediaCapturePermissionForOrigin:initiatedByFrame:type:decisionHandler: is the
// same as answering WKPermissionDecisionPrompt. What the delegate decides is whether the request
// becomes a system TCC prompt at all — so crust installs one on every webview and answers itself:
// grant only when the app opted in with `security.microphone`, deny otherwise. A TCC request from
// a bundle with no NSMicrophoneUsageDescription terminates the process instead of prompting, and
// that is the state every app which never asked for a microphone is in.
// Camera is not a crust capability yet, so a camera or camera+microphone request is denied rather
// than granted into a camera TCC prompt this bundle declared no purpose for.
// The decision handler is a block, and TinyCC has no -fblocks, so it is called through its own
// invoke pointer — the block ABI `108_find.c` also relies on (isa, flags, reserved, invoke).
// macOS 12+ only, which is below crust's 13.0 floor; before 12 the selector did not exist and
// WebKit refused capture outright, so no older path is needed.

typedef void *media_t;

extern media_t objc_msgSend(void *self, void *sel, ...);
extern media_t objc_getClass(const char *name);
extern media_t sel_registerName(const char *name);
extern media_t objc_allocateClassPair(void *superclass, const char *name, unsigned long extra);
extern void objc_registerClassPair(void *cls);
extern int class_addMethod(void *cls, void *sel, void *imp, const char *types);
extern void objc_setAssociatedObject(void *object, const void *key, void *value,
                                     unsigned long policy);
extern void *objc_getAssociatedObject(void *object, const void *key);

// WKPermissionDecision: 0 prompt, 1 grant, 2 deny. WKMediaCaptureType: 0 camera, 1 microphone,
// 2 camera and microphone.
#define MEDIA_DENY 2
#define MEDIA_GRANT 1
#define MEDIA_TYPE_MICROPHONE 1

// OBJC_ASSOCIATION_RETAIN_NONATOMIC.
#define MEDIA_RETAIN 0x301

// The prefix of a block's layout on 64-bit: the invoke pointer is the fourth word. WebKit hands
// over a block it owns; it stays valid for the duration of this method.
typedef struct {
	void *isa;
	int flags;
	int reserved;
	void (*invoke)(void *, long long);
} media_decision_t;

static int media_grant;
static char media_key; // the address is the association key; the value is never read

// 1 only inside a real `.app`. `crust dev` runs Bun unbundled, so macOS has no Info.plist to read
// the purpose string from and a granted request would have TCC terminate the process instead of
// prompting. The dev run therefore answers deny, which is the same outcome as no opt-in.
static int media_bundled(void) {
	media_t bundle = ((media_t (*)(void *, void *))objc_msgSend)(
	    objc_getClass("NSBundle"), sel_registerName("mainBundle"));
	if (!bundle) return 0;
	media_t identifier =
	    ((media_t (*)(void *, void *))objc_msgSend)(bundle, sel_registerName("bundleIdentifier"));
	return identifier ? 1 : 0;
}

static int media_has(void *obj, const char *name) {
	if (!obj) return 0;
	return (int)(char)((char (*)(void *, void *, void *))objc_msgSend)(
	    obj, sel_registerName("respondsToSelector:"), sel_registerName(name));
}

// The IMP. `decision` is WebKit's block; it must be called exactly once, and the decision is a
// scalar so nothing outlives this call.
static void media_decide(void *self, void *cmd, void *web, void *origin, void *frame,
                         long long type, void *decision) {
	media_t block = decision;
	(void)self;
	(void)cmd;
	(void)web;
	(void)origin;
	(void)frame;
	if (!block) return;
	media_decision_t *handler = (media_decision_t *)block;
	if (!handler->invoke) return;
	int decision_value =
	    (media_grant && type == MEDIA_TYPE_MICROPHONE && media_bundled()) ? MEDIA_GRANT : MEDIA_DENY;
	handler->invoke(block, (long long)decision_value);
}

// The delegate class, built once and reused by every webview. 0 when NSObject is missing or the
// runtime refused a step.
static void *media_class(void) {
	void *cls = objc_getClass("CrustMediaDelegate");
	if (cls) return cls;
	void *super = objc_getClass("NSObject");
	if (!super) return 0;
	// objc_allocateClassPair answers nil for a name that already exists, so the lookup comes first.
	cls = objc_allocateClassPair(super, "CrustMediaDelegate", 0);
	if (!cls) return 0;
	if (!class_addMethod(cls,
	                     sel_registerName("webView:requestMediaCapturePermissionForOrigin:"
	                                      "initiatedByFrame:type:decisionHandler:"),
	                     (void *)media_decide, "v@:@@@q@"))
		return 0;
	objc_registerClassPair(cls);
	return cls;
}

// 0 installed, 1 no webview or a missing selector, 3 the delegate class could not be built,
// 4 already installed (the association answered), 5 this webview already has a UI delegate that
// is not ours — refusing beats clobbering one.
int shim_media_capture_install(void *web, int grant) {
	if (!web) return 1;
	if (!media_has(web, "setUIDelegate:")) return 1;
	if (objc_getAssociatedObject(web, &media_key)) return 4;
	// The getter is `-UIDelegate` with a capital U (WKWebView.h:106); the setter is
	// `-setUIDelegate:`. The lowercase spelling answers 0 on a real WKWebView, measured here.
	if (!media_has(web, "UIDelegate")) return 1;
	media_t current = ((media_t (*)(void *, void *))objc_msgSend)(web,
	                                                              sel_registerName("UIDelegate"));
	if (current) return 5;

	void *cls = media_class();
	if (!cls) return 3;
	media_t delegate = ((media_t (*)(void *, void *))objc_msgSend)(cls, sel_registerName("new"));
	if (!delegate) return 3;
	media_grant = grant ? 1 : 0;
	// The association is set before the delegate, so the object outlives the unretained
	// -setUIDelegate: send.
	objc_setAssociatedObject(web, &media_key, delegate, MEDIA_RETAIN);
	((void (*)(void *, void *, void *))objc_msgSend)(web, sel_registerName("setUIDelegate:"),
	                                                 delegate);
	return 0;
}

// 1 when a delegate this unit installed is still attached. The probe reads it back rather than
// trusting the install's own return code.
int shim_media_capture_installed(void *web) {
	if (!web) return 0;
	return objc_getAssociatedObject(web, &media_key) ? 1 : 0;
}
