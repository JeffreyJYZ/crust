// --- the hwnd -> minimum-size table --------------------------------------
// A window's configured drag floor, keyed by HWND and read by `20_class.c`'s WM_GETMINMAXINFO.
// It lives in its own part because the webview table beside it was the file that crossed the
// 200-line cap, and the fix for a cap is another file, never a trimmed comment.
//
// `SHIM_MAX_WINDOWS` and `shim_h` both come from the parts before this one — the shim is one
// translation unit assembled in a fixed order, not a set of independently compiled objects.

// Zero on an axis means "no constraint" there, which is also how a destroy clears the entry.
static int g_min_w[SHIM_MAX_WINDOWS];
static int g_min_h[SHIM_MAX_WINDOWS];
static shim_h g_min_hwnd[SHIM_MAX_WINDOWS];
static int g_min_count;

void shim_window_set_min(shim_h hwnd, int w, int h) {
	int i;
	if (!hwnd) return;
	for (i = 0; i < g_min_count; i++)
		if (g_min_hwnd[i] == hwnd) {
			// Compacting on clear matters: this table is 8 slots, and an app that creates and closes
			// windows for hours would otherwise fill it and silently stop recording new ones.
			if (w <= 0 && h <= 0) {
				g_min_hwnd[i] = g_min_hwnd[g_min_count - 1];
				g_min_w[i] = g_min_w[g_min_count - 1];
				g_min_h[i] = g_min_h[g_min_count - 1];
				g_min_count--;
				return;
			}
			g_min_w[i] = w;
			g_min_h[i] = h;
			return;
		}
	if (w <= 0 && h <= 0) return;
	if (g_min_count < SHIM_MAX_WINDOWS) {
		i = g_min_count++;
		g_min_hwnd[i] = hwnd;
		g_min_w[i] = w;
		g_min_h[i] = h;
	}
}

void shim_window_min(shim_h hwnd, int *w, int *h) {
	int i;
	if (w) *w = 0;
	if (h) *h = 0;
	for (i = 0; i < g_min_count; i++)
		if (g_min_hwnd[i] == hwnd) {
			if (w) *w = g_min_w[i];
			if (h) *h = g_min_h[i];
			return;
		}
}
