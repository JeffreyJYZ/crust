// --- GTK window API --------------------------------------------------------
// The `crust:window` half: every entry point here is resolved on first use with
// `shim_sym_or_null`, never from `shim_gtk_resolve`, so a GTK too old for one
// answers `unknown-adapter` naming that entry point instead of refusing to
// launch every app. Nothing below is required by `shim_lib_open`.
//
// The resolved table and its one gate live here; the state and chrome entry
// points that call it are the next part, in the same translation unit, so they
// see these statics without a second resolve.
//
// Two requests GTK3 cannot honestly serve, and the JS side refuses both by name
// rather than inventing an answer: there is no process-wide cursor, and a
// toplevel can only be placed on an X11 display (`shim_window_placeable`).

static int api_state; // 0 unresolved, 1 ready, -1 missing an entry point
static char api_missing[96];

static void (*api_present)(void *);
static void (*api_set_title)(void *, const char *);
static const char *(*api_get_title)(void *);
static void (*api_resize)(void *, int, int);
static void (*api_get_size)(void *, int *, int *);
static void (*api_move)(void *, int, int);
static void (*api_get_position)(void *, int *, int *);
static void (*api_keep_above)(void *, int);
static void (*api_iconify)(void *);
static void (*api_deiconify)(void *);
static void (*api_maximize)(void *);
static void (*api_unmaximize)(void *);
static void (*api_fullscreen)(void *);
static void (*api_unfullscreen)(void *);
static void (*api_set_decorated)(void *, int);
static int (*api_get_decorated)(void *);
static void (*api_set_opacity)(void *, double);
static double (*api_get_opacity)(void *);
static void *(*api_widget_window)(void *);
static int (*api_window_state)(void *);
static void *(*api_default_display)(void);
static const char *(*api_display_name)(void *);

static void api_note(const char *name) {
	int i = 0;
	while (name && name[i] && i < 95) {
		api_missing[i] = name[i];
		i++;
	}
	api_missing[i] = 0;
}

static int api_resolve(void) {
	void *h = shim_gtk_handle();
#define API(field, name)                                                                          \
	field = shim_sym_or_null(h, name);                                                            \
	if (!field) {                                                                                 \
		api_note(name);                                                                           \
		return 0;                                                                                 \
	}
	API(api_present, "gtk_window_present")
	API(api_set_title, "gtk_window_set_title")
	API(api_get_title, "gtk_window_get_title")
	API(api_resize, "gtk_window_resize")
	API(api_get_size, "gtk_window_get_size")
	API(api_move, "gtk_window_move")
	API(api_get_position, "gtk_window_get_position")
	API(api_keep_above, "gtk_window_set_keep_above")
	API(api_iconify, "gtk_window_iconify")
	API(api_deiconify, "gtk_window_deiconify")
	API(api_maximize, "gtk_window_maximize")
	API(api_unmaximize, "gtk_window_unmaximize")
	API(api_fullscreen, "gtk_window_fullscreen")
	API(api_unfullscreen, "gtk_window_unfullscreen")
	API(api_set_decorated, "gtk_window_set_decorated")
	API(api_get_decorated, "gtk_window_get_decorated")
	API(api_set_opacity, "gtk_widget_set_opacity")
	API(api_get_opacity, "gtk_widget_get_opacity")
	API(api_widget_window, "gtk_widget_get_window")
	API(api_window_state, "gdk_window_get_state")
	API(api_default_display, "gdk_display_get_default")
	API(api_display_name, "gdk_display_get_name")
#undef API
	return 1;
}

int shim_window_api_ready(void) {
	if (api_state == 0) api_state = api_resolve() ? 1 : -1;
	return api_state == 1;
}

// The one entry point that was absent, so a refusal can name it. Empty when the
// API resolved, and empty before the first call: `shim_window_api_ready` fills it.
const char *shim_window_api_missing(void) { return api_missing; }

int shim_window_present(void *win) {
	if (!win || !shim_window_api_ready()) return 0;
	api_present(win);
	return 1;
}

int shim_window_set_title(void *win, const char *title) {
	if (!win || !title || !shim_window_api_ready()) return 0;
	api_set_title(win, title);
	return 1;
}

// The pointer GTK owns for the window's own title: read back immediately, never
// stored, and never freed here — it belongs to the window, not to this shim.
const char *shim_window_title(void *win) {
	if (!win || !shim_window_api_ready()) return "";
	const char *title = api_get_title(win);
	return title ? title : "";
}

int shim_window_resize(void *win, int w, int h) {
	if (!win || w <= 0 || h <= 0 || !shim_window_api_ready()) return 0;
	api_resize(win, w, h);
	return 1;
}

int shim_window_size(void *win, int *out) {
	if (!win || !out || !shim_window_api_ready()) return 0;
	int w = 0;
	int h = 0;
	api_get_size(win, &w, &h);
	// A zero axis means GTK has not allocated the window yet, so there is no
	// measured size to report rather than a size of nothing.
	if (w <= 0 || h <= 0) return 0;
	out[0] = w;
	out[1] = h;
	return 1;
}
