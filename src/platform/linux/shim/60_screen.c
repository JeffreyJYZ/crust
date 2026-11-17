// --- monitors --------------------------------------------------------------
// GDK's display/monitor enumeration, resolved lazily with `shim_sym_or_null` rather than in
// `shim_gtk_resolve`: a display list is not needed before a window exists, and a GTK too old to
// carry one of these must fail this surface by name instead of refusing to launch every app.
//
// GTK3, not GTK4: the shim loads libgtk-3.so.0, whose GDK has no `gdk_display_get_monitors` — the
// index-based pair below is the whole API there. `shim_screen_ready` is what tells "GDK cannot
// enumerate" apart from "no display is connected", which are different answers to a page.

static void *(*shim_gdk_default_display)(void);
static int (*shim_gdk_n_monitors)(void *display);
static void *(*shim_gdk_monitor)(void *display, int index);
static void (*shim_gdk_geometry)(void *monitor, void *rect);
static void (*shim_gdk_workarea)(void *monitor, void *rect);
static int (*shim_gdk_scale)(void *monitor);
static void *(*shim_gdk_primary)(void *display);

static int shim_screen_resolved;

// GdkRectangle is four 32-bit ints, so it lives on the C stack here and never crosses bun:ffi.
typedef struct {
	int x;
	int y;
	int width;
	int height;
} shim_gdk_rect;

static void shim_screen_resolve(void) {
	if (shim_screen_resolved) return;
	void *h = shim_gtk_handle();
	shim_screen_resolved = 1;
	if (!h) return;
	shim_gdk_default_display = shim_sym_or_null(h, "gdk_display_get_default");
	shim_gdk_n_monitors = shim_sym_or_null(h, "gdk_display_get_n_monitors");
	shim_gdk_monitor = shim_sym_or_null(h, "gdk_display_get_monitor");
	shim_gdk_geometry = shim_sym_or_null(h, "gdk_monitor_get_geometry");
	shim_gdk_workarea = shim_sym_or_null(h, "gdk_monitor_get_workarea");
	shim_gdk_scale = shim_sym_or_null(h, "gdk_monitor_get_scale_factor");
	shim_gdk_primary = shim_sym_or_null(h, "gdk_display_get_primary_monitor");
}

// 1 when GTK carries every entry point this surface needs; 0 names a GDK that cannot enumerate.
int shim_screen_ready(void) {
	shim_screen_resolve();
	return shim_gdk_default_display && shim_gdk_n_monitors && shim_gdk_monitor &&
	               shim_gdk_geometry && shim_gdk_workarea
	           ? 1
	           : 0;
}

// How many displays GDK reports. 0 when it cannot be asked, which is why `shim_screen_ready` is a
// separate call rather than being folded into this answer.
int shim_screen_count(void) {
	shim_screen_resolve();
	if (!shim_screen_ready() || !shim_gdk_default_display) return 0;
	void *display = shim_gdk_default_display();
	if (!display) return 0;
	int n = shim_gdk_n_monitors(display);
	return n > 0 ? n : 0;
}

// Ten doubles for one display: frame x/y/w/h, work area x/y/w/h, scale, then the primary flag.
// GDK's rectangles are already top-left with y down, so nothing is flipped. The primary comes from
// `gdk_display_get_primary_monitor` compared by address, which is GDK's own answer rather than a
// guess from index 0.
int shim_screen_info(int index, double *out) {
	if (out == 0 || index < 0) return 0;
	shim_screen_resolve();
	if (!shim_screen_ready()) return 0;
	void *display = shim_gdk_default_display();
	if (!display) return 0;
	if (index >= shim_gdk_n_monitors(display)) return 0;
	void *monitor = shim_gdk_monitor(display, index);
	if (!monitor) return 0;
	shim_gdk_rect geom;
	shim_gdk_rect work;
	shim_gdk_geometry(monitor, &geom);
	shim_gdk_workarea(monitor, &work);
	out[0] = (double)geom.x;
	out[1] = (double)geom.y;
	out[2] = (double)geom.width;
	out[3] = (double)geom.height;
	out[4] = (double)work.x;
	out[5] = (double)work.y;
	out[6] = (double)work.width;
	out[7] = (double)work.height;
	int scale = shim_gdk_scale ? shim_gdk_scale(monitor) : 0;
	out[8] = scale > 0 ? (double)scale : 1.0;
	void *primary = shim_gdk_primary ? shim_gdk_primary(display) : 0;
	out[9] = primary != 0 && primary == monitor ? 1.0 : 0.0;
	return 1;
}
