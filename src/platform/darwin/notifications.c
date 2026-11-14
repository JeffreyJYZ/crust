// crust macOS notifications — compiled at launch by bun:ffi's cc().
//
// The same four rules as shim.c, each measured in DESIGN.md §2:
//
//  1. EVERY objc_msgSend call site casts to a FIXED prototype. A plain
//     `extern void *objc_msgSend(void *, void *, ...)` compiles and delivers
//     wrong arguments with no diagnostic.
//  2. No framework headers. <AppKit/AppKit.h>, <Foundation/Foundation.h> and
//     <UserNotifications/UserNotifications.h> are unreachable from TinyCC, so
//     every symbol is a hand-written extern over void *.
//  3. No struct crosses bun:ffi. The block literals below are built, kept and
//     consumed entirely on this side.
//  4. The title and body cross as NUL-terminated byte buffers, never as objects:
//     a short ASCII NSString is a tagged pointer and cannot round-trip.
//
// Two delivery paths, and the status says which one actually ran:
//
//   UNUserNotificationCenter   the real API. `+currentNotificationCenter` aborts
//                              the process with an NSInternalInconsistencyException
//                              when the process has no bundle identity, and an
//                              ObjC exception is a SIGABRT with no JavaScript
//                              error, so this path is entered only when
//                              -[NSBundle bundleIdentifier] is non-nil. Measured
//                              here: the class resolves, the identifier is nil,
//                              so on this machine the fallback is the live path.
//   NSUserNotificationCenter   deprecated, still present, and the only path an
//                              unbundled process can use. It has no authorization
//                              call and no delivery report at all.
//
// Status codes, mirrored by NOTIFICATION_STATUS in notifications.ts:
#define NF_DELIVERED 0 // the OS accepted the notification and reported no error
#define NF_AUTH 1      // authorization pending or denied: nothing was delivered
#define NF_MISSING 2   // a class or selector is absent, or neither path is reachable
#define NF_ERROR 3     // the API answered with an error

#define NF_REASON_BYTES 512
#define NF_SKIP_BYTES 192
#define NF_AUTH_WAIT_MS 1500
#define NF_DELIVER_WAIT_MS 1500

typedef void *obj_t;

extern obj_t objc_msgSend(void *self, void *sel, ...);
extern obj_t objc_getClass(const char *name);
extern obj_t sel_registerName(const char *name);
extern void *class_getInstanceMethod(void *cls, void *sel);
extern int usleep(unsigned int usec);

// --- state -----------------------------------------------------------------

static char nf_reason[NF_REASON_BYTES]; // why the last post ended as it did
static char nf_skip[NF_SKIP_BYTES];     // why UNUserNotificationCenter was skipped
static int nf_center;                   // 0 none, 1 UNUserNotificationCenter, 2 the deprecated center
static int nf_counter;                  // request identifier sequence

static void nf_cat(char *dst, long cap, const char *src) {
	long i = 0;
	if (cap <= 0) return;
	while (dst[i] && i < cap - 1) i++;
	if (!src) {
		dst[i] = 0;
		return;
	}
	while (*src && i < cap - 1) dst[i++] = *src++;
	dst[i] = 0;
}

static void nf_set(char *dst, long cap, const char *src) {
	if (cap <= 0) return;
	dst[0] = 0;
	nf_cat(dst, cap, src);
}

static long nf_strlen(const char *s) {
	long n = 0;
	if (!s) return 0;
	while (s[n]) n++;
	return n;
}

static obj_t nf_sel(const char *name) { return sel_registerName(name); }

// class_getInstanceMethod walks the superclass chain, so this answers "could an
// instance of this class answer this selector" without ever sending it.
static int nf_has_instance(const char *cls, const char *selname) {
	void *c = objc_getClass(cls);
	if (!c) return 0;
	return class_getInstanceMethod(c, nf_sel(selname)) != 0;
}

// [obj respondsToSelector:sel] — the honest existence test for a class object.
static int nf_responds(obj_t obj, const char *selname) {
	if (!obj) return 0;
	obj_t s = nf_sel("respondsToSelector:");
	obj_t candidate = nf_sel(selname);
	if (!s || !candidate) return 0;
	return (int)(char)((char (*)(void *, void *, void *))objc_msgSend)(obj, s, candidate);
}

// One NSString, built and consumed on this side. Encoding 4 is
// NSUTF8StringEncoding, and -initWithBytes:length:encoding: is the measured
// constructor: +stringWithUTF8String: aborts Bun outright.
static obj_t nf_nsstring(const char *s) {
	if (!s) s = "";
	obj_t allocd = ((obj_t (*)(void *, void *))objc_msgSend)(objc_getClass("NSString"),
	                                                        nf_sel("alloc"));
	if (!allocd) return 0;
	return ((obj_t (*)(void *, void *, const char *, unsigned long, long long))objc_msgSend)(
	    allocd, nf_sel("initWithBytes:length:encoding:"), s, (unsigned long)nf_strlen(s), 4LL);
}

// --- bundle identity -------------------------------------------------------

// -[NSBundle bundleIdentifier] is nil in an unbundled process, and that is the
// exact condition under which +[UNUserNotificationCenter currentNotificationCenter]
// raises. The check is the guard, so the dangerous send is never reached.
static int nf_has_bundle_id(void) {
	obj_t cls = objc_getClass("NSBundle");
	if (!cls) return 0;
	if (!nf_responds(cls, "mainBundle")) return 0;
	obj_t bundle = ((obj_t (*)(void *, void *))objc_msgSend)(cls, nf_sel("mainBundle"));
	if (!bundle) return 0;
	if (!nf_has_instance("NSBundle", "bundleIdentifier")) return 0;
	obj_t ident = ((obj_t (*)(void *, void *))objc_msgSend)(bundle, nf_sel("bundleIdentifier"));
	if (!ident) return 0;
	unsigned long long length = ((unsigned long long (*)(void *, void *))objc_msgSend)(
	    ident, nf_sel("length"));
	return length > 0;
}

// --- completion handlers ---------------------------------------------------
//
// A block is plain memory: { isa, flags, reserved, invoke, descriptor }. A
// GLOBAL block (flags bit 28) needs no copy or dispose helper and no heap, which
// is what makes it constructible from C with no compiler support. The isa is
// found through objc_getClass("__NSGlobalBlock__") rather than the exported
// _NSConcreteGlobalBlock data symbol, so a missing symbol cannot break linking.
#define NF_BLOCK_GLOBAL (1 << 28)

typedef struct {
	unsigned long reserved;
	unsigned long size;
} nf_descriptor;

typedef struct {
	void *isa;
	int flags;
	int reserved;
	void (*invoke)(void *, int, void *); // (^)(BOOL granted, NSError *error)
	void *descriptor;
} nf_auth_block_t;

typedef struct {
	void *isa;
	int flags;
	int reserved;
	void (*invoke)(void *, void *); // (^)(NSError *error)
	void *descriptor;
} nf_job_block_t;

static volatile int nf_auth_done;
static volatile int nf_auth_granted;
static volatile int nf_job_done;
static volatile int nf_job_failed;

// What the OS said when it refused. "Denied" alone hides the difference between a user
// declining and the system refusing an app it does not recognise — `UNErrorDomain code=1`
// with no text is what an unsigned or unregistered bundle gets — so the code and the
// localized description are kept and reported.
static char nf_error_text[NF_REASON_BYTES];
static char nf_error_domain[128];
static int nf_error_code;

static int nf_same(const char *a, const char *b) {
	while (*a && *a == *b) {
		a++;
		b++;
	}
	return *a == *b;
}

static void nf_take_error(void *error) {
	nf_error_text[0] = 0;
	nf_error_domain[0] = 0;
	nf_error_code = 0;
	if (!error) return;
	nf_error_code =
	    (int)((long long (*)(void *, void *))objc_msgSend)(error, sel_registerName("code"));
	void *domain = ((void *(*)(void *, void *))objc_msgSend)(error, sel_registerName("domain"));
	if (domain) {
		const char *utf8 =
		    ((const char *(*)(void *, void *))objc_msgSend)(domain, sel_registerName("UTF8String"));
		if (utf8) nf_set(nf_error_domain, sizeof nf_error_domain, utf8);
	}
	void *description =
	    ((void *(*)(void *, void *))objc_msgSend)(error, sel_registerName("localizedDescription"));
	if (!description) return;
	const char *utf8 =
	    ((const char *(*)(void *, void *))objc_msgSend)(description, sel_registerName("UTF8String"));
	if (utf8) nf_set(nf_error_text, NF_REASON_BYTES, utf8);
}

static void nf_auth_invoke(void *block, int granted, void *error) {
	(void)block;
	nf_auth_granted = granted ? 1 : 0;
	if (!granted) nf_take_error(error);
	nf_auth_done = 1;
}

static void nf_job_invoke(void *block, void *error) {
	(void)block;
	nf_job_failed = error ? 1 : 0;
	nf_job_done = 1;
}

static nf_descriptor nf_auth_desc;
static nf_auth_block_t nf_auth_block;
static nf_descriptor nf_job_desc;
static nf_job_block_t nf_job_block;
static int nf_blocks_ready;

static int nf_blocks_init(void) {
	if (nf_blocks_ready) return 1;
	obj_t isa = objc_getClass("__NSGlobalBlock__");
	if (!isa) return 0;
	nf_auth_desc.reserved = 0;
	nf_auth_desc.size = sizeof(nf_auth_block_t);
	nf_auth_block.isa = isa;
	nf_auth_block.flags = NF_BLOCK_GLOBAL;
	nf_auth_block.reserved = 0;
	nf_auth_block.invoke = nf_auth_invoke;
	nf_auth_block.descriptor = &nf_auth_desc;
	nf_job_desc.reserved = 0;
	nf_job_desc.size = sizeof(nf_job_block_t);
	nf_job_block.isa = isa;
	nf_job_block.flags = NF_BLOCK_GLOBAL;
	nf_job_block.reserved = 0;
	nf_job_block.invoke = nf_job_invoke;
	nf_job_block.descriptor = &nf_job_desc;
	nf_blocks_ready = 1;
	return 1;
}

// The completion handlers run on a private queue, not the main one, so the
// bounded wait is a sleep loop rather than a run-loop pump. Both waits are short
// and only the modern path ever reaches them.
static void nf_wait(volatile int *flag, int millis) {
	int waited = 0;
	while (!*flag && waited < millis) {
		usleep(5000);
		waited += 5;
	}
}

// "crust-<n>": a fresh identifier per post, so a second notification is queued
// beside the first rather than replacing it.
static obj_t nf_identifier(void) {
	char buf[32];
	char digits[12];
	int used = 0;
	int value;
	nf_set(buf, 32, "crust-");
	value = ++nf_counter;
	do {
		digits[used++] = (char)('0' + (value % 10));
		value /= 10;
	} while (value > 0);
	while (used > 0) {
		char one[2];
		one[0] = digits[--used];
		one[1] = 0;
		nf_cat(buf, 32, one);
	}
	return nf_nsstring(buf);
}

// --- the modern path: UNUserNotificationCenter -----------------------------
//
// Returns -1 when it cannot run at all (and says why in nf_skip), otherwise a
// status. A -1 must fall through to the deprecated center; anything else is the
// answer, because falling back after a denial would ask twice.
static int nf_post_modern(const char *title, const char *body, int auth_wait_ms) {
	obj_t cls = objc_getClass("UNUserNotificationCenter");
	obj_t content_cls = objc_getClass("UNMutableNotificationContent");
	obj_t request_cls = objc_getClass("UNNotificationRequest");

	if (!cls || !content_cls || !request_cls) {
		nf_set(nf_skip, NF_SKIP_BYTES, "the UserNotifications framework is not linked");
		return -1;
	}
	if (!nf_has_bundle_id()) {
		nf_set(nf_skip, NF_SKIP_BYTES,
		       "an unbundled process has no bundle identifier, which "
		       "+[UNUserNotificationCenter currentNotificationCenter] aborts on");
		return -1;
	}
	if (!nf_responds(cls, "currentNotificationCenter")) {
		nf_set(nf_skip, NF_SKIP_BYTES, "+[UNUserNotificationCenter currentNotificationCenter] is absent");
		return -1;
	}
	if (!nf_has_instance("UNUserNotificationCenter", "requestAuthorizationWithOptions:completionHandler:")) {
		nf_set(nf_skip, NF_SKIP_BYTES, "-requestAuthorizationWithOptions:completionHandler: is absent");
		return -1;
	}
	if (!nf_has_instance("UNUserNotificationCenter", "addNotificationRequest:withCompletionHandler:")) {
		nf_set(nf_skip, NF_SKIP_BYTES, "-addNotificationRequest:withCompletionHandler: is absent");
		return -1;
	}
	if (!nf_responds(request_cls, "requestWithIdentifier:content:trigger:")) {
		nf_set(nf_skip, NF_SKIP_BYTES, "+[UNNotificationRequest requestWithIdentifier:content:trigger:] is absent");
		return -1;
	}
	if (!nf_has_instance("UNMutableNotificationContent", "setTitle:")) {
		nf_set(nf_skip, NF_SKIP_BYTES, "-[UNMutableNotificationContent setTitle:] is absent");
		return -1;
	}
	if (!nf_blocks_init()) {
		nf_set(nf_skip, NF_SKIP_BYTES,
		       "the __NSGlobalBlock__ class is absent, so a completion handler cannot be built");
		return -1;
	}

	obj_t center = ((obj_t (*)(void *, void *))objc_msgSend)(cls, nf_sel("currentNotificationCenter"));
	if (!center) {
		nf_set(nf_skip, NF_SKIP_BYTES, "+currentNotificationCenter returned nil");
		return -1;
	}
	nf_center = 1;

	// Authorization is requested explicitly, before anything is queued.
	// Options 6 is alert | sound.
	nf_auth_done = 0;
	nf_auth_granted = 0;
	((void (*)(void *, void *, unsigned long long, void *))objc_msgSend)(
	    center, nf_sel("requestAuthorizationWithOptions:completionHandler:"),
	    (unsigned long long)6, (void *)&nf_auth_block);
	// The caller owns this wait: a first post triggers the system permission prompt, and
	// 1500 ms — what this used to allow — is shorter than a person takes to read a dialog.
	// Clamped, because a negative or absurd value would stall an invoke for no reason.
	nf_wait(&nf_auth_done, auth_wait_ms < 0 ? 0 : auth_wait_ms > 120000 ? 120000 : auth_wait_ms);
	if (!nf_auth_done) {
		nf_cat(nf_reason, NF_REASON_BYTES,
		       "UNUserNotificationCenter: authorization was requested and the OS has not answered "
		       "yet, so nothing is confirmed as delivered");
		return NF_AUTH;
	}
	if (!nf_auth_granted) {
		char line[NF_REASON_BYTES];
		line[0] = 0;
		nf_cat(line, NF_REASON_BYTES, "UNUserNotificationCenter: authorization was denied");
		if (nf_error_code != 0 || nf_error_text[0]) {
			// The OS's own words, not ours: `UNErrorDomain` says the system refused the app,
			// `com.apple.usernotifications` says the user did, and the two need opposite
			// responses — register or sign, versus ask again later.
			char detail[NF_REASON_BYTES];
			detail[0] = 0;
			nf_cat(detail, sizeof detail, " (code ");
			char digits[16];
			int value = nf_error_code;
			int at = 0;
			if (value == 0) {
				digits[at++] = '0';
			} else {
				if (value < 0) {
					digits[at++] = '-';
					value = -value;
				}
				char reversed[12];
				int count = 0;
				while (value > 0 && count < 11) {
					reversed[count++] = (char)('0' + (value % 10));
					value /= 10;
				}
				while (count > 0) digits[at++] = reversed[--count];
			}
			digits[at] = 0;
			nf_cat(detail, sizeof detail, digits);
			if (nf_error_text[0]) {
				nf_cat(detail, sizeof detail, ": ");
				nf_cat(detail, sizeof detail, nf_error_text);
			}
			nf_cat(detail, sizeof detail, ")");
			nf_cat(line, NF_REASON_BYTES, detail);
			// Measured on 2026-11-14, and it overturns the earlier reading: this is not about
			// the signature. The same bundle identifier answered code 1 ad-hoc, under an
			// Apple-issued Apple Development certificate, launched directly and through
			// LaunchServices, from dist and from ~/Applications. A *fresh* bundle identifier
			// answered `delivered: true` under ad-hoc and under Apple Development alike, in
			// both locations. So authorization is cached per bundle identifier, and once that
			// identifier is recorded as denied nothing re-asks; the way out is a new identifier.
			if (nf_error_code == 1 && nf_same(nf_error_domain, "UNErrorDomain")) {
				nf_cat(line, NF_REASON_BYTES,
				       ". macOS caches notification authorization per bundle identifier, and this "
				       "one is recorded as denied — the signature is not the cause (ad-hoc and an "
				       "Apple Development certificate both deliver under a fresh identifier). Give "
				       "the app a new CFBundleIdentifier in crust.config.ts, e.g. app.id, and it is "
				       "asked again");
			}
		}
		nf_set(nf_reason, NF_REASON_BYTES, line);
		return NF_AUTH;
	}

	obj_t content = ((obj_t (*)(void *, void *))objc_msgSend)(content_cls, nf_sel("alloc"));
	content = content ? ((obj_t (*)(void *, void *))objc_msgSend)(content, nf_sel("init")) : 0;
	if (!content) {
		nf_cat(nf_reason, NF_REASON_BYTES, "UNUserNotificationCenter: UNMutableNotificationContent could not be built");
		return NF_ERROR;
	}
	obj_t title_text = nf_nsstring(title);
	if (!title_text) {
		nf_cat(nf_reason, NF_REASON_BYTES, "UNUserNotificationCenter: the title NSString could not be built");
		return NF_ERROR;
	}
	if (nf_has_instance("UNMutableNotificationContent", "setTitle:"))
		((void (*)(void *, void *, obj_t))objc_msgSend)(content, nf_sel("setTitle:"), title_text);
	if (nf_strlen(body) > 0 && nf_has_instance("UNMutableNotificationContent", "setBody:")) {
		obj_t body_text = nf_nsstring(body);
		if (body_text)
			((void (*)(void *, void *, obj_t))objc_msgSend)(content, nf_sel("setBody:"), body_text);
	}

	obj_t identifier = nf_identifier();
	if (!identifier) {
		nf_cat(nf_reason, NF_REASON_BYTES, "UNUserNotificationCenter: the request identifier could not be built");
		return NF_ERROR;
	}
	// A nil trigger delivers immediately.
	obj_t request = ((obj_t (*)(void *, void *, obj_t, obj_t, obj_t))objc_msgSend)(
	    request_cls, nf_sel("requestWithIdentifier:content:trigger:"), identifier, content, (obj_t)0);
	if (!request) {
		nf_cat(nf_reason, NF_REASON_BYTES, "UNUserNotificationCenter: +requestWithIdentifier:content:trigger: returned nil");
		return NF_ERROR;
	}

	nf_job_done = 0;
	nf_job_failed = 0;
	((void (*)(void *, void *, obj_t, void *))objc_msgSend)(
	    center, nf_sel("addNotificationRequest:withCompletionHandler:"), request,
	    (void *)&nf_job_block);
	nf_wait(&nf_job_done, NF_DELIVER_WAIT_MS);
	if (!nf_job_done) {
		nf_cat(nf_reason, NF_REASON_BYTES,
		       "UNUserNotificationCenter: the request was handed over and the OS has not answered "
		       "yet, so delivery is unconfirmed");
		return NF_AUTH;
	}
	if (nf_job_failed) {
		nf_cat(nf_reason, NF_REASON_BYTES,
		       "UNUserNotificationCenter: -addNotificationRequest:withCompletionHandler: reported an error");
		return NF_ERROR;
	}
	nf_cat(nf_reason, NF_REASON_BYTES,
	       "UNUserNotificationCenter scheduled the request and its completion handler reported no "
	       "error (the OS offers no \"the user saw it\" signal)");
	return NF_DELIVERED;
}

// --- the fallback: NSUserNotificationCenter --------------------------------

// Records which selector is absent, so a status 2 names it instead of guessing.
// `as_class` 1 tests `[Class respondsToSelector:]`, 0 tests the instance chain.
static int nf_absent(const char *cls, const char *selname, int as_class) {
	int present = as_class ? nf_responds((obj_t)objc_getClass(cls), selname)
	                       : nf_has_instance(cls, selname);
	if (present) return 0;
	nf_cat(nf_reason, NF_REASON_BYTES, cls);
	nf_cat(nf_reason, NF_REASON_BYTES, as_class ? " +" : " -");
	nf_cat(nf_reason, NF_REASON_BYTES, selname);
	nf_cat(nf_reason, NF_REASON_BYTES, " is absent");
	return 1;
}

// Deprecated since macOS 11, and on macOS 27 the class is a husk: measured,
// NSUserNotification answers -init but has no -setTitle:, -setInformativeText:
// or -setBody:, so nothing with content can be built and this path reports a
// missing symbol rather than delivering an empty notification. There is no
// authorization call and no delivery report in this API either:
// -deliverNotification: returns void, so "accepted with no exception" would be
// the strongest fact it could give.
static int nf_post_deprecated(const char *title, const char *body) {
	obj_t center_cls = objc_getClass("NSUserNotificationCenter");
	obj_t note_cls = objc_getClass("NSUserNotification");

	if (!center_cls || !note_cls) {
		nf_cat(nf_reason, NF_REASON_BYTES,
		       "neither UNUserNotificationCenter nor NSUserNotificationCenter can be used here");
		return NF_MISSING;
	}
	if (nf_absent("NSUserNotificationCenter", "defaultUserNotificationCenter", 1)) return NF_MISSING;
	if (nf_absent("NSUserNotificationCenter", "deliverNotification:", 0)) return NF_MISSING;
	if (nf_absent("NSUserNotification", "alloc", 1)) return NF_MISSING;
	if (nf_absent("NSUserNotification", "init", 0)) return NF_MISSING;
	if (nf_absent("NSUserNotification", "setTitle:", 0)) return NF_MISSING;

	obj_t center = ((obj_t (*)(void *, void *))objc_msgSend)(center_cls,
	                                                        nf_sel("defaultUserNotificationCenter"));
	if (!center) {
		nf_cat(nf_reason, NF_REASON_BYTES,
		       "NSUserNotificationCenter: +defaultUserNotificationCenter returned nil");
		return NF_ERROR;
	}

	obj_t note = ((obj_t (*)(void *, void *))objc_msgSend)(note_cls, nf_sel("alloc"));
	note = note ? ((obj_t (*)(void *, void *))objc_msgSend)(note, nf_sel("init")) : 0;
	if (!note) {
		nf_cat(nf_reason, NF_REASON_BYTES, "NSUserNotificationCenter: NSUserNotification could not be built");
		return NF_ERROR;
	}

	obj_t title_text = nf_nsstring(title);
	if (!title_text) {
		nf_cat(nf_reason, NF_REASON_BYTES, "NSUserNotificationCenter: the title NSString could not be built");
		return NF_ERROR;
	}
	((void (*)(void *, void *, obj_t))objc_msgSend)(note, nf_sel("setTitle:"), title_text);
	if (nf_strlen(body) > 0 && nf_has_instance("NSUserNotification", "setInformativeText:")) {
		obj_t body_text = nf_nsstring(body);
		if (body_text)
			((void (*)(void *, void *, obj_t))objc_msgSend)(note, nf_sel("setInformativeText:"), body_text);
	}

	nf_center = 2;
	((void (*)(void *, void *, obj_t))objc_msgSend)(center, nf_sel("deliverNotification:"), note);
	nf_cat(nf_reason, NF_REASON_BYTES,
	       "NSUserNotificationCenter accepted the notification; that API has no authorization call "
	       "and no delivery report, so acceptance is all it can state");
	return NF_DELIVERED;
}

// --- exports ---------------------------------------------------------------

// Post one notification. Status 0 delivered, 1 authorization pending or denied,
// 2 symbol missing, 3 API error. `title` and `body` are NUL-terminated byte
// buffers, never objects; `body` may be "" and must never be null from JS.
int crust_notification_post(const char *title, const char *body, int auth_wait_ms) {
	int status;
	nf_reason[0] = 0;
	nf_skip[0] = 0;
	nf_center = 0;

	if (!title || !title[0]) {
		nf_set(nf_reason, NF_REASON_BYTES, "a notification needs a non-empty title");
		return NF_ERROR;
	}
	if (!body) body = "";

	status = nf_post_modern(title, body, auth_wait_ms);
	if (status < 0) status = nf_post_deprecated(title, body);

	// Say why the real API was skipped, once, ahead of the answering path.
	if (nf_skip[0]) {
		char combined[NF_REASON_BYTES];
		combined[0] = 0;
		nf_cat(combined, NF_REASON_BYTES, "UNUserNotificationCenter was not used: ");
		nf_cat(combined, NF_REASON_BYTES, nf_skip);
		nf_cat(combined, NF_REASON_BYTES, ". ");
		nf_cat(combined, NF_REASON_BYTES, nf_reason);
		nf_set(nf_reason, NF_REASON_BYTES, combined);
	}
	if (!nf_reason[0]) nf_set(nf_reason, NF_REASON_BYTES, "no reason was recorded");
	return status;
}

// Why the last post ended as it did. Static storage, valid until the next call.
const char *crust_notification_reason(void) { return nf_reason; }

// Which center answered the last post: 0 none, 1 UNUserNotificationCenter,
// 2 the deprecated NSUserNotificationCenter.
int crust_notification_center(void) { return nf_center; }
