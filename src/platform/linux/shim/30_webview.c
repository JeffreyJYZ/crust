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
//
// The load and eval records are per view, keyed by the handle these signals
// carry, and they live in the state part below: a window can hold more than one
// webview, so one process-wide slot would answer for whichever loaded last.

static WebKitWebView *(*shim_view_new)(void);
static void (*shim_view_load)(WebKitWebView *, const char *);

// The browser surface's reads. Each is resolved optionally, so a WebKitGTK too old for one answers a
// named gap in the proof rather than refusing to launch every app.
static const char *(*shim_view_uri)(WebKitWebView *);
static int (*shim_view_loading)(WebKitWebView *);
static int (*shim_view_can_back)(WebKitWebView *);
static int (*shim_view_can_forward)(WebKitWebView *);
static void (*shim_widget_destroy)(void *);

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

// The state part below owns the record; these are its two entry points and the
// three handlers this part connects at creation. Forward-declared because a
// handler has to be attached before the first load starts.
void shim_state_register(void *view);
void shim_host_forget(void *view);
void shim_state_reset_eval(void *view);
static void shim_state_load_changed(void *view, int event, void *data);
static int shim_state_load_failed(void *view, int event, const char *uri, void *error, void *data);
static void shim_state_eval_done(void *source, void *result, void *data);

// Bounded, always NUL-terminated: these buffers leave C as a cstring.
static void shim_copy_text(char *dst, int cap, const char *src) {
	int i = 0;
	while (src && src[i] && i < cap - 1) {
		dst[i] = src[i];
		i++;
	}
	dst[i] = 0;
}

int shim_webkit_resolve(void) {
	void *h = shim_webkit_handle();
	int core = shim_sym(h, "webkit_web_view_new", (void **)&shim_view_new) &&
	           shim_sym(h, "webkit_web_view_load_uri", (void **)&shim_view_load);
	shim_view_title = (ShimTitleFn)shim_sym_or_null(h, "webkit_web_view_get_title");
	shim_view_uri = (const char *(*)(WebKitWebView *))shim_sym_or_null(h, "webkit_web_view_get_uri");
	shim_view_loading = (int (*)(WebKitWebView *))shim_sym_or_null(h, "webkit_web_view_is_loading");
	shim_view_can_back =
	    (int (*)(WebKitWebView *))shim_sym_or_null(h, "webkit_web_view_can_go_back");
	shim_view_can_forward =
	    (int (*)(WebKitWebView *))shim_sym_or_null(h, "webkit_web_view_can_go_forward");
	shim_widget_destroy = (void (*)(void *))shim_sym_or_null(shim_gtk_handle(), "gtk_widget_destroy");
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
	if (!view) return 0;
	// Registered at creation, so a state read for this handle can never answer
	// with the record a destroyed view left at the same address.
	shim_state_register(view);
	// Connected at creation, because a load starts the moment the window loads and
	// a handler attached afterwards would miss its own first event.
	if (shim_view_connect) {
		shim_view_connect(view, "load-changed", (void *)shim_state_load_changed, 0, 0, 0);
		shim_view_connect(view, "load-failed", (void *)shim_state_load_failed, 0, 0, 0);
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

// The address WebKit holds for this view: empty before the first commit, and empty when the
// library carries no `get_uri` — the same "not there yet" a caller already reads.
const char *shim_webview_uri(void *web) {
	if (!web || !shim_view_uri) return 0;
	return shim_view_uri((WebKitWebView *)web);
}

// 1 while a main-frame load is in flight. Read from WebKit, never tracked here: a redirect chain and
// a failed load both start and finish without a rule this layer could keep.
int shim_webview_is_loading(void *web) {
	if (!web || !shim_view_loading) return 0;
	return shim_view_loading((WebKitWebView *)web) ? 1 : 0;
}

int shim_webview_can_back(void *web) {
	if (!web || !shim_view_can_back) return 0;
	return shim_view_can_back((WebKitWebView *)web) ? 1 : 0;
}

int shim_webview_can_forward(void *web) {
	if (!web || !shim_view_can_forward) return 0;
	return shim_view_can_forward((WebKitWebView *)web) ? 1 : 0;
}

// Take one surface out of its container and destroy it. `gtk_widget_destroy` removes the widget from
// its parent, so the overlay keeps no child that is about to be freed.
int shim_webview_close(void *web) {
	if (!web || !shim_widget_destroy) return 0;
	shim_host_forget(web);
	shim_widget_destroy(web);
	return 1;
}

int shim_webview_eval(void *web, const char *script) {
	if (!web || !script || !shim_view_eval) return 0;
	shim_state_reset_eval(web);
	// -1: the script is NUL-terminated. No world name and no source URI, so it
	// runs in the page's own context, where document.title is visible.
	shim_view_eval((WebKitWebView *)web, script, -1, 0, 0, 0, (void *)shim_state_eval_done, 0);
	return 1;
}
