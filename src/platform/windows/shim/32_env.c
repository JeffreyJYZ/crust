// --- environment and controller, one helper per vtable slot ---------------
// The one export crust needs from WebView2Loader.dll, which ships beside the binary.
// `options` is null: crust needs no additional browser arguments, and the only member worth
// setting (SetCustomSchemeRegistration) lives on ICoreWebView2EnvironmentOptions4, a later
// runtime than the filter path already needs.
extern shim_i64 CreateCoreWebView2EnvironmentWithOptions(const shim_wchar *browserDir,
                                                         const shim_wchar *userDataDir, void *options,
                                                         void *handler);

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
	int hasDir = userData && userData[0];
	if (hasDir && shim_utf16(userData, dir, 1024) < 0) return 0;
	handler_init(&env, handler_vtbl);
	if (CreateCoreWebView2EnvironmentWithOptions(0, hasDir ? dir : 0, 0, &env) < 0) return 0;
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
