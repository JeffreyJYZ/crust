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
// Each wait is its own export so a probe can print the call, the HRESULT and the callback separately.
// This is the first place the process hands a hand-built COM object to Windows, and three runs died
// inside it with nothing but "webview_new" to go on.
typedef shim_i64 (*shim_create_env_fn)(const shim_wchar *browserDir, const shim_wchar *userDataDir,
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
static shim_handler g_env_handler;
static shim_handler g_ctrl_handler;

// What each object produced, once its callback has fired; 0 until then.
void *shim_environment_handle(void) { return g_env_handler.result; }
void *shim_controller_handle(void) { return g_ctrl_handler.result; }

// 1 when the bytes Windows reads as the vtable pointer really are the table this layer filled.
int shim_handler_prepare(void) {
	void *table;
	handler_init(&g_env_handler);
	handler_init(&g_ctrl_handler);
	table = (void *)(shim_h)shim_handler_vtbl_addr();
	return *(void **)&g_env_handler == table ? 1 : 0;
}

shim_i64 shim_handler_object_addr(void) { return (shim_i64)(void *)&g_env_handler; }

shim_i64 shim_handler_first_field(void) { return (shim_i64)(void *)*(void **)&g_env_handler; }

// ICoreWebView2Environment slot 3.
shim_i64 wv2_env_create_controller(void *env, shim_h hwnd, void *handler) {
	void **vt = *(void ***)env;
	return ((shim_i64 (*)(void *, shim_h, void *))vt[SHIM_SLOT_ENV_CREATE_CONTROLLER])(
	    env, hwnd, handler);
}

// ICoreWebView2Controller slot 25: the ICoreWebView2 the page-facing calls go to.
shim_i64 wv2_controller_webview(void *ctrl, void **out) {
	void **vt = *(void ***)ctrl;
	return ((shim_i64 (*)(void *, void **))vt[SHIM_SLOT_CONTROLLER_WEBVIEW])(ctrl, out);
}

// Start the environment and return the HRESULT of the call itself, before any callback.
shim_i64 shim_env_begin(const char *userData) {
	shim_wchar dir[1024];
	shim_create_env_fn create_env;
	int hasDir = userData && userData[0];
	if (hasDir && shim_utf16(userData, dir, 1024) < 0) return -2147024809LL; /* E_INVALIDARG */
	create_env = shim_load_create_env();
	if (!create_env) return -2147467259LL; /* E_FAIL */
	handler_init(&g_env_handler);
	return create_env(0, hasDir ? dir : 0, 0, &g_env_handler);
}

// Drain the queue for up to 5 s. 1 when the callback fired, 0 when it timed out.
int shim_env_wait(void) {
	handler_wait(&g_env_handler, 5000);
	return g_env_handler.done;
}

// The HRESULT the completion handler carried; 0 when it never fired.
shim_i64 shim_env_callback(void) { return g_env_handler.failed; }

// Start the controller for one window and return the HRESULT of the call itself.
shim_i64 shim_controller_begin(shim_h hwnd) {
	if (!g_env_handler.result) return -2147467259LL; /* E_FAIL */
	handler_init(&g_ctrl_handler);
	return wv2_env_create_controller(g_env_handler.result, hwnd, &g_ctrl_handler);
}

int shim_controller_wait(void) {
	handler_wait(&g_ctrl_handler, 5000);
	return g_ctrl_handler.done;
}

shim_i64 shim_controller_callback(void) { return g_ctrl_handler.failed; }
