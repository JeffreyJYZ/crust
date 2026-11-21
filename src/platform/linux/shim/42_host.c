// --- the surface's positioned host ----------------------------------------
// Split from `41_container.c` at the line cap. The window container stays there; this part is every
// call whose subject is one embedded surface: its GtkFixed wrapper, its rectangle, and the GTK
// readbacks the smoke uses to attribute an allocation. Both compile into one translation unit, so
// the pointers resolved in `41_container.c` are in scope here.

// Every surface has its own GtkFixed, keyed by the webview it holds. The wrapper is the overlay
// child; the webview is its only child, and GTK allocates it at the size requested below. A closed
// surface forgets its slot so a new view at the same address cannot inherit the old wrapper.
static void *shim_host_view[SHIM_BOX_MAX];
static void *shim_host_fixed[SHIM_BOX_MAX];

void *shim_webview_host(void *web) {
	if (!web) return 0;
	for (int i = 0; i < SHIM_BOX_MAX; i++)
		if (shim_host_view[i] == web) return shim_host_fixed[i];
	return 0;
}

void shim_host_forget(void *web) {
	if (!web) return;
	for (int i = 0; i < SHIM_BOX_MAX; i++) {
		if (shim_host_view[i] == web) {
			shim_host_view[i] = 0;
			shim_host_fixed[i] = 0;
			return;
		}
	}
}

static void *shim_host_for(void *web) {
	void *host = shim_webview_host(web);
	int slot = -1;
	if (host || !web || !shim_fixed_new || !shim_container_add) return host;
	host = shim_fixed_new();
	if (!host) return 0;
	for (int i = 0; i < SHIM_BOX_MAX; i++) {
		if (!shim_host_view[i]) {
			slot = i;
			break;
		}
	}
	if (slot < 0) return 0;
	shim_host_view[slot] = web;
	shim_host_fixed[slot] = host;
	return host;
}

// Put a child at a rectangle in window points inside one window's box. The first
// call adds it as an overlay child; a later call moves it, so a resize or a drag
// is a rectangle change rather than another webview. GTK warns when a widget is
// added twice, so membership is asked of GTK itself — no table to go stale when
// a surface's widget is destroyed and a new one takes its address.
int shim_webview_place(void *box, void *web, int x, int y, int w, int h) {
	void *host;
	if (!box || !web || !shim_overlay_add || !shim_widget_parent) return 0;
	host = shim_host_for(web);
	if (!host) return 0;
	// The wrapper is the overlay child; the webview is a child of the wrapper, so its allocation is
	// its own size request and not the overlay's remaining area.
	if (shim_widget_parent(host) != box) shim_overlay_add(box, host);
	if (shim_widget_parent(web) != host) shim_container_add(host, web);
	if (shim_widget_show) shim_widget_show(host);
	if (shim_widget_show) shim_widget_show(web);
	if (shim_set_hexpand) shim_set_hexpand(host, 0);
	if (shim_set_vexpand) shim_set_vexpand(host, 0);
	if (shim_set_halign) shim_set_halign(host, SHIM_ALIGN_START);
	if (shim_set_valign) shim_set_valign(host, SHIM_ALIGN_START);
	// A negative origin is not a position: 0 is the container's own corner.
	if (shim_set_margin_start) shim_set_margin_start(host, x > 0 ? x : 0);
	if (shim_set_margin_top) shim_set_margin_top(host, y > 0 ? y : 0);
	if (w > 0 && h > 0) {
		if (shim_set_size_request) shim_set_size_request(host, w, h);
		// The webview carries the same request, so GtkFixed gives it exactly this rectangle.
		if (shim_set_size_request) shim_set_size_request(web, w, h);
	}
	if (shim_queue_resize) shim_queue_resize(host);
	if (shim_queue_resize) shim_queue_resize(box);
	return 1;
}
