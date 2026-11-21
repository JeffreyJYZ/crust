// --- Positioned container --------------------------------------------------
// A GtkWindow takes exactly one child, so a second webview has nowhere to go:
// `gtk_container_add` on the window holds one, and the second call is a GTK
// warning with nothing on screen. Each window therefore gets a container of its
// own, and the app's own webview is that container's main child.
//
// GtkOverlay, not GtkFixed, and the difference is what a resize does. A fixed
// container's children keep the size they were given, so the app's page would
// stay at its opening size and never follow the window; an overlay's main child
// takes the whole allocation with no handler in C. An embedded surface is an
// overlay child, which the overlay places by points: alignment START plus the
// rectangle's origin as margins, at a size request. That is the whole geometry
// contract — the app owns where the rectangle goes, and this layer obeys it.

// GtkAlign: FILL is 0, START is 1.
#define SHIM_ALIGN_START 1
// The same ceiling as the window slots below, because a box exists per window.
#define SHIM_BOX_MAX 32

static void *(*shim_overlay_new)(void);
static void (*shim_overlay_add)(void *, void *);
static void (*shim_widget_show)(void *);
static void (*shim_set_halign)(void *, int);
static void (*shim_set_valign)(void *, int);
static void (*shim_set_margin_start)(void *, int);
static void (*shim_set_margin_top)(void *, int);
static void *(*shim_widget_parent)(void *);
static int (*shim_widget_allocated_width)(void *);
static int (*shim_widget_allocated_height)(void *);

// Resolved by `shim_lib_open` with the rest of GTK: a window whose box cannot be
// built is a window with nowhere to put its own page, so the absence belongs in
// the preflight text rather than in a half-built window.
int shim_container_resolve(void) {
	void *h = shim_gtk_handle();
	return shim_sym(h, "gtk_overlay_new", (void **)&shim_overlay_new) &&
	       shim_sym(h, "gtk_overlay_add_overlay", (void **)&shim_overlay_add) &&
	       shim_sym(h, "gtk_widget_show", (void **)&shim_widget_show) &&
	       shim_sym(h, "gtk_widget_set_halign", (void **)&shim_set_halign) &&
	       shim_sym(h, "gtk_widget_set_valign", (void **)&shim_set_valign) &&
	       shim_sym(h, "gtk_widget_set_margin_start", (void **)&shim_set_margin_start) &&
	       shim_sym(h, "gtk_widget_set_margin_top", (void **)&shim_set_margin_top) &&
	       shim_sym(h, "gtk_widget_get_parent", (void **)&shim_widget_parent);
}

// The allocation reads are optional: they exist for the proof, which asks whether a placed surface
// really took the rectangle it was given, and an older GTK that lacks them answers 0 rather than
// refusing the launch.
static void shim_container_resolve_reads(void) {
	void *h = shim_gtk_handle();
	if (!shim_widget_allocated_width)
		shim_widget_allocated_width =
		    (int (*)(void *))shim_sym_or_null(h, "gtk_widget_get_allocated_width");
	if (!shim_widget_allocated_height)
		shim_widget_allocated_height =
		    (int (*)(void *))shim_sym_or_null(h, "gtk_widget_get_allocated_height");
}

/** The allocation a placed widget actually received: 0 width, 1 height; 0 for a refused read. */
int shim_webview_allocated(void *web, int which) {
	shim_container_resolve_reads();
	if (!web) return 0;
	if (which == 0) return shim_widget_allocated_width ? shim_widget_allocated_width(web) : 0;
	return shim_widget_allocated_height ? shim_widget_allocated_height(web) : 0;
}

typedef struct {
	void *win;
	void *box;
} shim_box;

static shim_box shim_boxes[SHIM_BOX_MAX];
static int shim_box_count;

// One box per window, created on first use and returned again after: attaching
// the app's webview and opening a surface later must reach the same container,
// or the surface lands in a box nothing sized.
void *shim_window_container(void *win) {
	if (!win) return 0;
	for (int i = 0; i < shim_box_count; i++)
		if (shim_boxes[i].win == win) return shim_boxes[i].box;
	if (!shim_overlay_new || !shim_container_add) return 0;
	void *box = shim_overlay_new();
	if (!box) return 0;
	// `gtk_container_add` on a GtkOverlay sets its main child, which is the one
	// that fills the window.
	shim_container_add(win, box);
	int slot = -1;
	for (int i = 0; i < shim_box_count; i++) {
		if (!shim_boxes[i].win) {
			slot = i;
			break;
		}
	}
	// The window table caps live windows at 32 and this caps boxes at 32, so no
	// window can exist whose box has nowhere to be recorded.
	if (slot < 0 && shim_box_count < SHIM_BOX_MAX) slot = shim_box_count++;
	if (slot < 0) return 0;
	shim_boxes[slot].win = win;
	shim_boxes[slot].box = box;
	return box;
}

// A destroyed window frees its box with it, so the entry must go too: a new
// window can land on the same address, and it needs a box of its own.
void shim_container_forget(void *win) {
	if (!win) return;
	for (int i = 0; i < shim_box_count; i++) {
		if (shim_boxes[i].win == win) {
			shim_boxes[i].win = 0;
			shim_boxes[i].box = 0;
			return;
		}
	}
}

// Put a child at a rectangle in window points inside one window's box. The first
// call adds it as an overlay child; a later call moves it, so a resize or a drag
// is a rectangle change rather than another webview. GTK warns when a widget is
// added twice, so membership is asked of GTK itself — no table to go stale when
// a surface's widget is destroyed and a new one takes its address.
int shim_webview_place(void *box, void *web, int x, int y, int w, int h) {
	if (!box || !web || !shim_overlay_add || !shim_widget_parent) return 0;
	if (shim_widget_parent(web) != box) shim_overlay_add(box, web);
	// A surface is created after the window was shown, so nothing but this brings the new child
	// into the allocation: a hidden overlay child is allocated 0x0 and its document never renders.
	if (shim_widget_show) shim_widget_show(web);
	if (shim_set_halign) shim_set_halign(web, SHIM_ALIGN_START);
	if (shim_set_valign) shim_set_valign(web, SHIM_ALIGN_START);
	// A negative origin is not a position: 0 is the container's own corner.
	if (shim_set_margin_start) shim_set_margin_start(web, x > 0 ? x : 0);
	if (shim_set_margin_top) shim_set_margin_top(web, y > 0 ? y : 0);
	// No size keeps the child's natural one, which is what a caller that only
	// moves a surface relies on.
	if (w > 0 && h > 0 && shim_set_size_request) shim_set_size_request(web, w, h);
	return 1;
}
