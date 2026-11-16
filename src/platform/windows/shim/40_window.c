// --- windows ---------------------------------------------------------------

// CreateWindowExW needs the class atom's *name*, which is why the caller passes it: crust
// registers one class per app name and every window is an instance of it.
shim_h shim_window_new(const char *title, int w, int h, const char *cls) {
	shim_wchar clsBuf[256];
	shim_wchar titleBuf[512];
	shim_h hwnd;
	if (shim_utf16(cls, clsBuf, 256) < 0) return 0;
	if (shim_utf16(title, titleBuf, 512) < 0) return 0;
	hwnd = CreateWindowExW(0u, clsBuf, titleBuf, SHIM_WS_OVERLAPPEDWINDOW, SHIM_CW_USEDEFAULT,
	                       SHIM_CW_USEDEFAULT, w, h, 0, 0, GetModuleHandleW(0), 0);
	if (!hwnd) return 0;
	ShowWindow(hwnd, SHIM_SW_SHOW);
	UpdateWindow(hwnd);
	return hwnd;
}

// Liveness is IsWindow, full stop: unlike AppKit's windowNumber, a Win32 handle is destroyed
// with the window and reads 0 afterwards, so one call answers "is this window gone".
int shim_window_is_open(shim_h hwnd) { return hwnd && IsWindow(hwnd) ? 1 : 0; }

int shim_window_set_title(shim_h hwnd, const char *title) {
	shim_wchar buf[512];
	if (!hwnd || shim_utf16(title, buf, 512) < 0) return 0;
	return SetWindowTextW(hwnd, buf) ? 1 : 0;
}

int shim_window_destroy(shim_h hwnd) {
	if (!hwnd) return 0;
	return DestroyWindow(hwnd) ? 1 : 0;
}

// One component of GetClientRect at a time, because no struct crosses bun:ffi.
// 0 = left, 1 = top, 2 = width, 3 = height.
int shim_window_client_num(shim_h hwnd, int component) {
	int rect[4];
	if (!hwnd) return 0;
	if (!GetClientRect(hwnd, rect)) return 0;
	if (component == 0) return rect[0];
	if (component == 1) return rect[1];
	if (component == 2) return rect[2] - rect[0];
	if (component == 3) return rect[3] - rect[1];
	return 0;
}

// The thread that owns a window. WebView2 objects are affine to a thread, so the controller call has to
// happen on the window's own; comparing this with `shim_thread_id()` at the call is the affinity
// question as a number rather than an argument.
int shim_window_thread(shim_h hwnd) {
	if (!hwnd || !GetWindowThreadProcessId) return 0;
	return (int)GetWindowThreadProcessId(hwnd, 0);
}

