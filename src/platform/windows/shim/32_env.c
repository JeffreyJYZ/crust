// --- environment and controller, one step at a time -----------------------
// The one export crust needs from WebView2Loader.dll, which ships beside the binary or on PATH.
// It is resolved here the same way `12_win32.c` resolves everything else: the loader is a runtime
// prerequisite, so a machine without it must lose one symbol rather than the whole shim. The preflight
// is what names a missing loader; a failed LoadLibraryW leaves GetLastError 126 (ERROR_MOD_NOT_FOUND)
// for the caller's message, and the handle is kept for the process lifetime because WebView2 lives as
// long. `options` is null: crust needs no additional browser arguments, and the only member worth
// setting (SetCustomSchemeRegistration) lives on ICoreWebView2EnvironmentOptions4, a later runtime
// than the filter path already needs.
//
// HRESULT is `int`. Every vtable call is declared to return `int` and only widened when it is stored,
// because a function that returns 32 bits leaves the top half of RAX undefined and a sign test on that
// garbage reads a success as a failure.
//
// Each wait is its own export so a probe can print the call, the HRESULT and the callback separately.
typedef int (*shim_create_env_fn)(const shim_wchar *browserDir, const shim_wchar *userDataDir,
                                  void *options, void *handler);

static shim_create_env_fn g_create_env;
static int g_create_env_done;

static shim_create_env_fn shim_load_create_env(void) {
	shim_wchar name[64];
	shim_h loader;
	if (g_create_env_done) return g_create_env;
	g_create_env_done = 1;
	if (!shim_win32_load()) return 0;
	if (shim_utf16("WebView2Loader.dll", name, 64) < 0) return 0;
	loader = LoadLibraryW(name);
	if (!loader) return 0;
	g_create_env =
	    (shim_create_env_fn)GetProcAddress(loader, "CreateCoreWebView2EnvironmentWithOptions");
	return g_create_env;
}

// Both handler objects are statics, not stack locals: WebView2 keeps the pointer until its completion
// arrives, so an object whose frame has returned is a callback into freed memory. They are also what
// the `shim_handler_*` readback inspects, which is how a wrong layout becomes a printed number.
static shim_i64 g_env_hresult;
static shim_i64 g_ctrl_hresult;

// The window the controller is being built for, and whether that request has been made. The request
// happens inside the environment's completion callback, so the window has to be in place before the
// environment call starts. `g_ctrl_requested` exists because the HRESULT cannot: S_OK is 0, so "no
// answer yet" and "answered S_OK" would be the same value.
static shim_h g_ctrl_hwnd;
static int g_ctrl_requested;
static int g_ctrl_pending;
static int g_ctrl_from;
/** 1 when the controller completion fired inside `CreateCoreWebView2Controller`, 0 when a pump got it. */
static int g_ctrl_inline;
/** 1 when the environment callback fired inside `create_env`, 0 when a later pump iteration got it. */
static int g_env_inline;

// What each object produced, once its callback has fired; 0 until then.
void *shim_environment_handle(void) { return g_env_handler.result; }
void *shim_controller_handle(void) { return g_ctrl_handler.result; }

// The HRESULT of the last begin call. The composite `shim_webview_new` returns 0/1, so the caller that
// needs the reason reads it here — a failed controller call and a callback that never came are
// different defects and only these two numbers tell them apart.
shim_i64 shim_env_hresult(void) { return g_env_hresult; }
shim_i64 shim_controller_hresult(void) { return g_ctrl_hresult; }

// ICoreWebView2Environment slot 3.
int wv2_env_create_controller(void *env, shim_h hwnd, void *handler) {
	void **vt = shim_object_vtbl(env);
	if (!vt) return -2147467259; /* E_FAIL: the object itself is unreadable */
	if (!shim_slot_ok(vt, SHIM_SLOT_ENV_CREATE_CONTROLLER)) return -2147467262; /* E_NOINTERFACE */
	return ((int (*)(void *, shim_h, void *))vt[SHIM_SLOT_ENV_CREATE_CONTROLLER])(env, hwnd,
	                                                                             handler);
}

// ICoreWebView2Controller slot 25: the ICoreWebView2 the page-facing calls go to.
int wv2_controller_webview(void *ctrl, void **out) {
	void **vt = shim_object_vtbl(ctrl);
	if (!vt) return -2147467259; /* E_FAIL: the object itself is unreadable */
	if (!shim_slot_ok(vt, SHIM_SLOT_CONTROLLER_WEBVIEW)) return -2147467262; /* E_NOINTERFACE */
	return ((int (*)(void *, void **))vt[SHIM_SLOT_CONTROLLER_WEBVIEW])(ctrl, out);
}

// Called from `handler_invoke` in `30_com.c`, inside the environment's completion callback. A WebView2
// object is affine to the frame that created it: the identical call one frame later answered
// UI_E_WRONG_THREAD (0x802A000C, "this method can only be called from the thread that created the
// object"), which is why this is here and not in `shim_controller_begin`.
void shim_controller_from_callback(void *env) {
	(void)env;
	if (!g_ctrl_hwnd || g_ctrl_requested) return;
	g_ctrl_pending = 1;
}

// The controller call, deferred by exactly one statement out of the callback. WebView2's threading model
// calls a nested loop or a reentrant call inside a handler unsupported, and the runner proved this is the
// reentrant case: `env_inline 1` means the environment completion ran inside
// `CreateCoreWebView2EnvironmentWithOptions`, and the controller built there had `0xffffffff` where its
// vtable belongs — a half-constructed object. So the callback records the request and this makes the call
// from the first moment WebView2's own stack is gone.
//
// This is NOT the same as `shim_controller_begin`, which is a *later FFI call* from JavaScript and
// answered UI_E_WRONG_THREAD. Both callers here stay inside one C call: `shim_env_begin` when the callback
// fired inline, `shim_env_wait` when it arrived during the pump. Do not simplify it back into the callback.
static void shim_controller_deferred(int from) {
	if (!g_ctrl_pending || g_ctrl_requested || !g_env_handler.result) return;
	g_ctrl_pending = 0;
	g_ctrl_requested = 1;
	g_ctrl_from = from;
	shim_note_thread(SHIM_THREAD_CTRL_CALL);
	g_ctrl_hresult = wv2_env_create_controller(g_env_handler.result, g_ctrl_hwnd, &g_ctrl_handler);
	g_ctrl_inline = g_ctrl_handler.done;
}

/**
 * 1 when the controller completion fired inside `CreateCoreWebView2Controller`, 0 when a later pump
 * iteration got it. An inline completion means the webview was constructed reentrantly and never saw a
 * message loop — which is a candidate cause of a fault inside WebView2 on the first `Navigate`.
 */
int shim_ctrl_inline(void) { return g_ctrl_inline; }

// Where the controller call was made: 2 right after `create_env` returned, 3 after a pump, 4 the
// fallback. 1 would mean back inside the callback, which is the shape that produced a half-built object.
int shim_ctrl_from(void) { return g_ctrl_from; }

// 1 when the environment callback fired *inside* `create_env` — the completion ran on the environment
// call's own stack rather than in a later pump iteration. Measured on the runner: `env_begin` took
// 643 ms and `env_wait` returned in 0.098 ms, so `done` was already set on entry. WebView2's threading
// page calls a nested loop inside a handler unsupported, so this is printed before anything is built
// on top of a controller that may have been created re-entrantly.
int shim_env_inline(void) { return g_env_inline; }

// Start the environment for one window and return the HRESULT of the call itself, before any callback.
// `hwnd` is the window the controller will be built for, and it is recorded before the call because the
// completion handler is what builds that controller.
shim_i64 shim_env_begin(shim_h hwnd, const char *userData) {
	shim_wchar dir[1024];
	shim_create_env_fn create_env;
	int hasDir = userData && userData[0];
	shim_note_thread(SHIM_THREAD_ENV_CALL);
	if (hasDir && shim_utf16(userData, dir, 1024) < 0) return -2147024809LL; /* E_INVALIDARG */
	create_env = shim_load_create_env();
	if (!create_env) return -2147467259LL; /* E_FAIL */
	// Both handlers are initialised here, before the environment call: the controller's callback fires
	// during `shim_env_wait`, and a `handler_init` after that would reset refs/done under it.
	handler_init(&g_env_handler, SHIM_THREAD_ENV_CALLBACK);
	handler_init(&g_ctrl_handler, SHIM_THREAD_CTRL_CALLBACK);
	g_ctrl_hwnd = hwnd;
	g_ctrl_requested = 0;
	g_ctrl_pending = 0;
	g_ctrl_from = 0;
	g_ctrl_hresult = 0;
	g_env_hresult = create_env(0, hasDir ? dir : 0, 0, &g_env_handler);
	g_env_inline = g_env_handler.done;
	shim_controller_deferred(2);
	return g_env_hresult;
}

// Drain the queue for up to 5 s. 1 when the callback fired, 0 when it timed out.
int shim_env_wait(void) {
	handler_wait(&g_env_handler, 5000);
	shim_controller_deferred(3);
	return g_env_handler.done;
}

// The HRESULT the completion handler carried; 0 when it never fired.
shim_i64 shim_env_callback(void) { return (shim_i64)g_env_handler.failed; }

// The fallback, for an environment that was already complete before a window was known: the callback
// that created it has returned, so the controller is built from here instead. Never twice — the
// environment callback already asked for this window, and repeating it would answer the same thing.
shim_i64 shim_controller_begin(shim_h hwnd) {
	if (!g_env_handler.result) return -2147467259LL; /* E_FAIL */
	if (g_ctrl_requested && g_ctrl_hwnd == hwnd) return g_ctrl_hresult;
	shim_note_thread(SHIM_THREAD_CTRL_CALL);
	handler_init(&g_ctrl_handler, SHIM_THREAD_CTRL_CALLBACK);
	g_ctrl_hwnd = hwnd;
	g_ctrl_requested = 1;
	g_ctrl_pending = 0;
	g_ctrl_from = 4;
	g_ctrl_hresult = wv2_env_create_controller(g_env_handler.result, hwnd, &g_ctrl_handler);
	g_ctrl_inline = g_ctrl_handler.done;
	return g_ctrl_hresult;
}

int shim_controller_wait(void) {
	handler_wait(&g_ctrl_handler, 5000);
	return g_ctrl_handler.done;
}

shim_i64 shim_controller_callback(void) { return (shim_i64)g_ctrl_handler.failed; }

