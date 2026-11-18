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
	// The TS caller clamped the create size to the configured minimum; record it as the drag floor.
	shim_window_set_min(hwnd, w, h);
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
	shim_window_set_min(hwnd, 0, 0);
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

// --- frame, state and foreground -------------------------------------------
// The four calls the window adapter's geometry commands need. Each reads or writes one number at a
// time: a RECT is a pointer to `int[4]` here, because a struct crossing bun:ffi by value is the arm64
// defect `34_slots.c` records.
//
// 0 = x, 1 = y, 2 = width, 3 = height, of the *window* rect (title bar and borders included), which
// is the same frame `SetWindowPos` moves and resizes.
// All four components in one call, into a caller-owned `int[4]`: 1 written, 0 when `GetWindowRect`
// failed. One at a time could not report failure — a component of 0 is a legal x, y, width or height,
// so a closed handle answered `0x0` and a caller could not tell that from a zero-sized window.
int shim_window_frame(shim_h hwnd, int *out) {
	int rect[4];
	if (!hwnd || !out) return 0;
	if (!GetWindowRect(hwnd, rect)) return 0;
	out[0] = rect[0];
	out[1] = rect[1];
	out[2] = rect[2] - rect[0];
	out[3] = rect[3] - rect[1];
	return 1;
}

// The rect the window goes back to when it is un-minimised or un-maximised:
// `WINDOWPLACEMENT.rcNormalPosition`. `GetWindowRect` answers the iconic off-screen rect for a
// minimised window (classically -32000,-32000) and the whole monitor for a maximised one, so neither
// is a frame a caller can save and restore. 1 written, 0 when the call failed.
int shim_window_normal_frame(shim_h hwnd, int *out) {
	shim_window_placement wp;
	if (!hwnd || !out) return 0;
	if (!shim_win32_load()) return 0;
	wp.length = (unsigned int)sizeof(shim_window_placement);
	if (!GetWindowPlacement(hwnd, &wp)) return 0;
	out[0] = wp.normalLeft;
	out[1] = wp.normalTop;
	out[2] = wp.normalRight - wp.normalLeft;
	out[3] = wp.normalBottom - wp.normalTop;
	return 1;
}

// Geometry only: SWP_NOZORDER | SWP_NOACTIVATE, so a resize never raises or focuses the window.
// 1 on success; 0 is a refused call, which the adapter reports with GetLastError beside it.
int shim_window_set_frame(shim_h hwnd, int x, int y, int w, int h) {
	if (!hwnd) return 0;
	return SetWindowPos(hwnd, 0, x, y, w, h, SHIM_SWP_GEOMETRY) ? 1 : 0;
}

// One verb for the three window-level toggles, so no caller repeats a ShowWindow command number.
// 0 = minimize, 1 = maximize, 2 = restore (which is also how a minimized window comes back).
int shim_window_show(shim_h hwnd, int verb) {
	if (!hwnd) return 0;
	ShowWindow(hwnd, verb == 0 ? SHIM_SW_MINIMIZE : verb == 1 ? SHIM_SW_MAXIMIZE : SHIM_SW_RESTORE);
	return 1;
}

int shim_window_is_minimized(shim_h hwnd) { return hwnd && IsIconic(hwnd) ? 1 : 0; }

int shim_window_is_maximized(shim_h hwnd) { return hwnd && IsZoomed(hwnd) ? 1 : 0; }

// 0 is the foreground lock refusing the call, which is a real answer on Windows and not a crash:
// the adapter turns it into `handler-error` naming the OS refusal rather than claiming focus.
int shim_window_focus(shim_h hwnd) {
	if (!hwnd) return 0;
	return SetForegroundWindow(hwnd) ? 1 : 0;
}

// The thread that owns a window. WebView2 objects are affine to a thread, so the controller call has to
// happen on the window's own; comparing this with `shim_thread_id()` at the call is the affinity
// question as a number rather than an argument.
int shim_window_thread(shim_h hwnd) {
	if (!hwnd || !GetWindowThreadProcessId) return 0;
	return (int)GetWindowThreadProcessId(hwnd, 0);
}

