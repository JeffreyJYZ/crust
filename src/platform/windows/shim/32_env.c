// --- environment and controller, one helper per vtable slot ---------------
// The one export crust needs from WebView2Loader.dll, which ships beside the binary or on PATH.
// It is resolved here rather than linked: TinyCC can only import a DLL whose directory is on its own
// library path, and that directory is wherever Edge happens to be installed, so a machine without the
// loader would lose the whole shim to a linker error instead of one symbol. The preflight is what
// names a missing loader; a failed LoadLibraryW leaves GetLastError 126 (ERROR_MOD_NOT_FOUND) for the
// caller's message, and the handle is kept for the process lifetime because WebView2 lives as long.
// `options` is null: crust needs no additional browser arguments, and the only member worth setting
// (SetCustomSchemeRegistration) lives on ICoreWebView2EnvironmentOptions4, a later runtime than the
// filter path already needs.
typedef shim_i64 (*shim_create_env_fn)(const shim_wchar *browserDir, const shim_wchar *userDataDir,
                                       void *options, void *handler);

static shim_create_env_fn g_create_env;
static int g_create_env_done;

static shim_create_env_fn shim_load_create_env(void) {
	shim_wchar name[64];
	shim_h loader;
	if (g_create_env_done) return g_create_env;
	g_create_env_done = 1;
	if (shim_utf16("WebView2Loader.dll", name, 64) < 0) return 0;
	loader = LoadLibraryW(name);
	if (!loader) return 0;
	g_create_env =
	    (shim_create_env_fn)GetProcAddress(loader, "CreateCoreWebView2EnvironmentWithOptions");
	return g_create_env;
}

// ICoreWebView2Environment slot 3.
shim_i64 wv2_env_create_controller(void *env, shim_h hwnd, void *handler) {
	void **vt = *(void ***)env;
	return ((shim_i64 (*)(void *, shim_h, void *))vt[3])(env, hwnd, handler);
}

// ICoreWebView2Controller slot 25: the ICoreWebView2 the page-facing calls go to.
shim_i64 wv2_controller_webview(void *ctrl, void **out) {
	void **vt = *(void ***)ctrl;
	return ((shim_i64 (*)(void *, void **))vt[25])(ctrl, out);
}

// Build the environment and wait for it. 0 on any failure, including a 5 s timeout.
void *shim_environment(const char *userData) {
	shim_wchar dir[1024];
	shim_handler env;
	shim_create_env_fn create_env;
	int hasDir = userData && userData[0];
	if (hasDir && shim_utf16(userData, dir, 1024) < 0) return 0;
	create_env = shim_load_create_env();
	if (!create_env) return 0;
	handler_init(&env, handler_vtbl);
	if (create_env(0, hasDir ? dir : 0, 0, &env) < 0) return 0;
	handler_wait(&env, 5000);
	return env.result;
}

// Build the controller for one window and wait for it. 0 on any failure.
void *shim_controller(void *env, shim_h hwnd) {
	shim_handler ctrl;
	if (!env) return 0;
	handler_init(&ctrl, handler_vtbl);
	if (wv2_env_create_controller(env, hwnd, &ctrl) < 0) return 0;
	handler_wait(&ctrl, 5000);
	return ctrl.result;
}
