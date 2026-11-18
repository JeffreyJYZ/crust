// --- GTK window state and chrome -------------------------------------------
// The entry points behind `setSize`'s neighbours: geometry placement, the four
// window-manager flags, decorations and opacity. They call the table and gate in
// the previous part, which is why they carry no resolve of their own.
//
// GdkWindowState bits, from gdk/gdkwindow.h: ICONIFIED 1<<1, MAXIMIZED 1<<2,
// FULLSCREEN 1<<4, ABOVE 1<<5. Read through `gdk_window_get_state`, the only
// GTK3 answer for a fullscreen or iconified window: GTK has no
// `gtk_window_is_fullscreen` and no iconified getter at all.

// 1 only for an X11 display name (":0", ":0.0"). Fail closed: a Wayland name is
// a compositor socket and GTK cannot place or report a toplevel there, so every
// other spelling answers 0 and the JS side refuses `setPosition` by name.
int shim_window_placeable(void) {
	if (!shim_window_api_ready()) return 0;
	void *display = api_default_display();
	if (!display) return 0;
	const char *name = api_display_name(display);
	if (!name || !name[0]) return 0;
	return name[0] == ':' ? 1 : 0;
}

int shim_window_move(void *win, int x, int y) {
	if (!win || !shim_window_placeable()) return 0;
	api_move(win, x, y);
	return 1;
}

int shim_window_position(void *win, int *out) {
	if (!win || !out || !shim_window_placeable()) return 0;
	int x = 0;
	int y = 0;
	api_get_position(win, &x, &y);
	out[0] = x;
	out[1] = y;
	return 1;
}

// The GdkWindowState word, or -1 when the widget has no GdkWindow yet — before
// `show` there is nothing for GDK to answer about, and 0 would claim "neither
// iconified nor fullscreen" instead of "unknown".
int shim_window_state(void *win) {
	if (!win || !shim_window_api_ready()) return -1;
	void *gdk = api_widget_window(win);
	if (!gdk) return -1;
	return api_window_state(gdk);
}

// flag: 0 iconified, 1 maximized, 2 fullscreen. One entry point rather than six,
// so the mapping from the plugin's names to GTK's pairs lives in one place.
int shim_window_flag(void *win, int flag, int on) {
	if (!win || !shim_window_api_ready()) return 0;
	if (flag == 0) {
		if (on) api_iconify(win);
		else api_deiconify(win);
	} else if (flag == 1) {
		if (on) api_maximize(win);
		else api_unmaximize(win);
	} else if (flag == 2) {
		if (on) api_fullscreen(win);
		else api_unfullscreen(win);
	} else {
		return 0;
	}
	return 1;
}

int shim_window_keep_above(void *win, int on) {
	if (!win || !shim_window_api_ready()) return 0;
	api_keep_above(win, on ? 1 : 0);
	return 1;
}

int shim_window_set_decorated(void *win, int on) {
	if (!win || !shim_window_api_ready()) return 0;
	api_set_decorated(win, on ? 1 : 0);
	return 1;
}

// -1 when GTK cannot answer, so a caller refuses rather than reporting a title
// bar that may not be there.
int shim_window_decorated(void *win) {
	if (!win || !shim_window_api_ready()) return -1;
	return api_get_decorated(win) ? 1 : 0;
}

int shim_widget_set_opacity(void *win, double value) {
	if (!win || !shim_window_api_ready()) return 0;
	api_set_opacity(win, value);
	return 1;
}

// -1 when unavailable: 0 is a real opacity (fully transparent), so the absent
// answer cannot share it.
double shim_widget_opacity(void *win) {
	if (!win || !shim_window_api_ready()) return -1;
	return api_get_opacity(win);
}
