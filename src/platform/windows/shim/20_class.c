// --- window class and procedure -------------------------------------------

// WNDCLASSEXW, 80 bytes on x64. Hand-written because the header that declares it is the one
// thing this unit cannot have.
typedef struct {
	unsigned int cbSize;
	unsigned int style;
	shim_i64 (*wndproc)(shim_h, unsigned int, shim_u64, shim_i64);
	int clsExtra;
	int wndExtra;
	shim_h instance;
	shim_h icon;
	shim_h cursor;
	shim_h background;
	const shim_wchar *menu;
	const shim_wchar *cls;
	shim_h iconSm;
} shim_wndclassex;

// Defined in 42_webview.c, which compiles after this part. WM_DESTROY needs both: the close to hand
// the controller slot back, and the live count to know whether the last window just went away.
void shim_webview_close(shim_h hwnd);
int shim_webview_live(void);

// Every crust window shares this procedure, so a title-bar close reaches DestroyWindow and WM_DESTROY.
// It releases the controller slot and posts the quit only when the last window is gone — the runtime's
// window-all-closed watcher owns the decision, so closing one of three must not end the app.
// A minimised window still reports IsWindow.
shim_i64 shim_wndproc(shim_h hwnd, unsigned int msg, shim_u64 wp, shim_i64 lp) {
	if (msg == SHIM_WM_SIZE) {
		// The client rect is the authority, not LPARAM: a DPI change reports a stale pair there.
		int rect[4];
		// A failed call leaves all four ints indeterminate; resizing to that garbage is worse
		// than skipping the resize. shim_window_client_num checks the same call below.
		if (!GetClientRect(hwnd, rect)) return 0;
		shim_webview_put_bounds(hwnd, (double)(rect[2] - rect[0]), (double)(rect[3] - rect[1]));
		return 0;
	}
	if (msg == SHIM_WM_GETMINMAXINFO) {
		// MINMAXINFO's ptMinTrackSize is the fifth POINT: offset 24 on x64, two 32-bit LONGs.
		// Set only configured dimensions, then let DefWindowProcW fill the maximum fields.
		int minw = 0, minh = 0;
		int *pt;
		shim_window_min(hwnd, &minw, &minh);
		if (minw > 0 || minh > 0) {
			pt = (int *)lp;
			if (minw > 0) pt[6] = minw;
			if (minh > 0) pt[7] = minh;
		}
	}
	if (msg == SHIM_WM_SETCURSOR) {
		// The pointer is the thread's, and DefWindowProcW would put the class arrow back on the next
		// move. 1 means a shape was set for this process, so the procedure answers TRUE (handled).
		if (shim_cursor_apply()) return 1;
	}
	if (msg == SHIM_WM_CLOSE) {
		DestroyWindow(hwnd);
		return 0;
	}
	if (msg == SHIM_WM_DESTROY) {
		// The title-bar X never reached shim_webview_close: eight closes exhausted the eight-slot
		// table and every later createWindow refused. Release the slot here, then quit only when no
		// tracked window remains so one of several closes leaves the app running.
		shim_webview_close(hwnd);
		if (shim_webview_live() == 0) PostQuitMessage(0);
		return 0;
	}
	return DefWindowProcW(hwnd, msg, wp, lp);
}

// Register the class once per process. The atom is what CreateWindowExW resolves, so a zero
// here is the one failure that makes every later CreateWindowExW return null.
shim_i64 shim_register_class(const char *name) {
	shim_wchar buf[256];
	shim_wndclassex wc;
	if (shim_utf16(name, buf, 256) < 0) return 0;
	wc.cbSize = sizeof(shim_wndclassex);
	wc.style = 0x0001u | 0x0002u; /* CS_VREDRAW | CS_HREDRAW */
	wc.wndproc = shim_wndproc;
	wc.clsExtra = 0;
	wc.wndExtra = 0;
	wc.instance = GetModuleHandleW(0);
	wc.icon = 0;
	wc.cursor = LoadCursorW(0, SHIM_IDC_ARROW);
	wc.background = 0;
	wc.menu = 0;
	wc.cls = buf;
	wc.iconSm = 0;
	return (shim_i64)RegisterClassExW(&wc);
}
