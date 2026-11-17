// --- WebKitGTK webview -----------------------------------------------------
// The view alone. It is created against the default context and navigates to the
// URL the window was created with — the same absolute bridge URL darwin hands to
// -loadRequest: — so no URI scheme is registered anywhere in this layer.
//
// The document half — the title, the load state and one script's answer — is
// what a proof reads back. All of it is resolved through `shim_sym_or_null`, so
// none of it gates `shim_lib_open`: `evaluate_javascript` arrived in WebKitGTK
// 2.40, and an older library must fail the proof's own line rather than refuse
// to launch every app.

static WebKitWebView *(*shim_view_new)(void);
static void (*shim_view_load)(WebKitWebView *, const char *);

typedef const char *(*ShimTitleFn)(WebKitWebView *);
typedef void (*ShimEvalFn)(WebKitWebView *, const char *, long, const char *, const char *, void *,
                           void *, void *);
typedef void *(*ShimEvalFinishFn)(WebKitWebView *, void *, void **);
typedef char *(*ShimToStringFn)(void *);
typedef void (*ShimUnrefFn)(void *);
typedef void (*ShimFreeFn)(void *);
typedef void (*ShimErrorFreeFn)(void *);
typedef unsigned long (*ShimSignalFn)(void *, const char *, void *, void *, void *, int);

static ShimTitleFn shim_view_title;
static ShimEvalFn shim_view_eval;
static ShimEvalFinishFn shim_view_eval_finish;
static ShimToStringFn shim_jsc_to_string;
static ShimUnrefFn shim_object_unref;
static ShimFreeFn shim_g_free;
static ShimErrorFreeFn shim_g_error_free;
static ShimSignalFn shim_view_connect;

// WEBKIT_LOAD_FINISHED is 3 and travels as the signal's own value; 4 is ours,
// because a failure arrives on `load-failed` rather than on `load-changed`.
#define SHIM_LOAD_FAILED 4

// One view is what a proof opens, so both answers are one slot: a second view
// would overwrite them rather than interleave.
static int shim_load_state;
static char shim_load_text[512];
static int shim_eval_state;
static char shim_eval_text[1024];

// GError as GLib lays it out. Read here, never returned: no struct crosses bun:ffi.
typedef struct {
	unsigned int domain;
	int code;
	char *message;
} ShimGError;

// Bounded, always NUL-terminated: these buffers leave C as a cstring.
static void shim_copy_text(char *dst, int cap, const char *src) {
	int i = 0;
	while (src && src[i] && i < cap - 1) {
		dst[i] = src[i];
		i++;
	}
	dst[i] = 0;
}

static void shim_on_load_changed(void *view, int event, void *data) {
	(void)view;
	(void)data;
	// A new navigation starts from a clean record. A failure is sticky, because WebKit follows
	// `load-failed` with a FINISHED for its own error page — measured on ubuntu-sandbox, where a
	// missing file reported 0, 4, 3, and the 3 alone would hide the failure.
	if (event == 0) {
		shim_load_state = 0;
		shim_load_text[0] = 0;
		return;
	}
	if (shim_load_state == SHIM_LOAD_FAILED) return;
	shim_load_state = event;
}

// The failure this signal exists for: the URI and GLib's own message, printed by
// the caller. FALSE lets WebKit show its error page, which is what an app shows.
static int shim_on_load_failed(void *view, int event, const char *uri, void *error, void *data) {
	(void)view;
	(void)event;
	(void)data;
	shim_load_state = SHIM_LOAD_FAILED;
	shim_copy_text(shim_load_text, 512, uri ? uri : "load failed");
	int used = 0;
	while (shim_load_text[used]) used++;
	ShimGError *gerror = (ShimGError *)error;
	if (gerror && gerror->message && used < 500) {
		shim_load_text[used++] = ':';
		shim_load_text[used++] = ' ';
		shim_copy_text(shim_load_text + used, 512 - used, gerror->message);
	}
	return 0;
}

static void shim_on_eval_done(void *source, void *result, void *data) {
	(void)data;
	void *error = 0;
	void *value = 0;
	if (shim_view_eval_finish)
		value = shim_view_eval_finish((WebKitWebView *)source, result, &error);
	if (error) {
		ShimGError *gerror = (ShimGError *)error;
		shim_copy_text(shim_eval_text, 1024, gerror->message ? gerror->message : "evaluate failed");
		// The GError is caller-owned and a failed finish may also hand back a
		// value. Free both here, the same way the success path does, or a page
		// that keeps throwing scripts leaks one GLib allocation per evaluation.
		if (value && shim_object_unref) shim_object_unref(value);
		if (shim_g_error_free) shim_g_error_free(error);
		shim_eval_state = 2;
		return;
	}
	char *text = (value && shim_jsc_to_string) ? shim_jsc_to_string(value) : 0;
	shim_copy_text(shim_eval_text, 1024, text ? text : "");
	// g_free, never free: Bun links mimalloc, so the shim's `free` resolves to it and handing it a
	// GLib string read an allocator header from a foreign block and faulted (address 0xA6D0,
	// measured on ubuntu-sandbox). The string is GLib's, so only GLib's own free fits.
	if (text && shim_g_free) shim_g_free(text);
	if (value && shim_object_unref) shim_object_unref(value);
	shim_eval_state = 1;
}

int shim_webkit_resolve(void) {
	void *h = shim_webkit_handle();
	int core = shim_sym(h, "webkit_web_view_new", (void **)&shim_view_new) &&
	           shim_sym(h, "webkit_web_view_load_uri", (void **)&shim_view_load);
	shim_view_title = (ShimTitleFn)shim_sym_or_null(h, "webkit_web_view_get_title");
	shim_view_eval = (ShimEvalFn)shim_sym_or_null(h, "webkit_web_view_evaluate_javascript");
	shim_view_eval_finish =
	    (ShimEvalFinishFn)shim_sym_or_null(h, "webkit_web_view_evaluate_javascript_finish");
	// Both live in libraries WebKit itself links, so the same handle finds them.
	shim_jsc_to_string = (ShimToStringFn)shim_sym_or_null(h, "jsc_value_to_string");
	shim_object_unref = (ShimUnrefFn)shim_sym_or_null(h, "g_object_unref");
	shim_g_free = (ShimFreeFn)shim_sym_or_null(h, "g_free");
	shim_g_error_free = (ShimErrorFreeFn)shim_sym_or_null(h, "g_error_free");
	shim_view_connect = (ShimSignalFn)shim_sym_or_null(h, "g_signal_connect_data");
	return core;
}

WebKitWebView *shim_webview_new(void) {
	if (!shim_view_new) return 0;
	WebKitWebView *view = shim_view_new();
	// Connected at creation, because a load starts the moment the window loads and
	// a handler attached afterwards would miss its own first event.
	if (view && shim_view_connect) {
		shim_view_connect(view, "load-changed", (void *)shim_on_load_changed, 0, 0, 0);
		shim_view_connect(view, "load-failed", (void *)shim_on_load_failed, 0, 0, 0);
	}
	return view;
}

int shim_webview_load(void *web, const char *url) {
	if (!web || !url || !shim_view_load) return 0;
	shim_view_load((WebKitWebView *)web, url);
	return 1;
}

// The title of the loaded document, not of the window: WebKit reads it from the
// document itself, so a value here is a document that parsed.
const char *shim_webview_title(void *web) {
	if (!web || !shim_view_title) return 0;
	return shim_view_title((WebKitWebView *)web);
}

// 0 started, 1 redirected, 2 committed, 3 finished, 4 failed.
int shim_webview_load_state(void) { return shim_load_state; }

const char *shim_webview_load_text(void) { return shim_load_text; }

int shim_webview_eval(void *web, const char *script) {
	if (!web || !script || !shim_view_eval) return 0;
	shim_eval_state = 0;
	shim_eval_text[0] = 0;
	// -1: the script is NUL-terminated. No world name and no source URI, so it
	// runs in the page's own context, where document.title is visible.
	shim_view_eval((WebKitWebView *)web, script, -1, 0, 0, 0, (void *)shim_on_eval_done, 0);
	return 1;
}

// 0 pending, 1 answered, 2 threw. The answer is text because it left C as bytes.
int shim_webview_eval_state(void) { return shim_eval_state; }

const char *shim_webview_eval_text(void) { return shim_eval_text; }
