// --- GTK window ------------------------------------------------------------
// A bare GtkWindow, never a GtkApplication: an application object owns
// gtk_main() and quits when the last window closes, while Bun's thread owns the
// loop here.

static void *(*shim_window_new_fn)(int);
static void (*shim_set_title)(void *, const char *);
static void (*shim_set_default_size)(void *, int, int);
static void (*shim_set_size_request)(void *, int, int);
static void (*shim_container_add)(void *, void *);
static void (*shim_show_all)(void *);
static void (*shim_destroy)(void *);
static void *(*shim_connect)(void *, const char *, void *, void *, void *, int);

int shim_gtk_resolve(void) {
	void *h = shim_gtk_handle();
	return shim_sym(h, "gtk_window_new", (void **)&shim_window_new_fn) &&
	       shim_sym(h, "gtk_window_set_title", (void **)&shim_set_title) &&
	       shim_sym(h, "gtk_window_set_default_size", (void **)&shim_set_default_size) &&
	       shim_sym(h, "gtk_widget_set_size_request", (void **)&shim_set_size_request) &&
	       shim_sym(h, "gtk_container_add", (void **)&shim_container_add) &&
	       shim_sym(h, "gtk_widget_show_all", (void **)&shim_show_all) &&
	       shim_sym(h, "gtk_widget_destroy", (void **)&shim_destroy) &&
	       shim_sym(h, "g_signal_connect_data", (void **)&shim_connect);
}

// A closed window's widget is freed by GTK, so liveness must never read it: the
// destroy signal flips a flag here and that flag is what `window(label)` reads.
// 32 slots is the ceiling on simultaneously tracked windows.
typedef struct {
	void *win;
	int alive;
} shim_slot;

static shim_slot shim_slots[32];
static int shim_slot_count;

static void shim_on_destroy(void *widget, void *data) {
	for (int i = 0; i < shim_slot_count; i++) {
		if (shim_slots[i].win == widget) shim_slots[i].alive = 0;
	}
}

int shim_window_alive(void *win) {
	if (!win) return 0;
	for (int i = 0; i < shim_slot_count; i++) {
		if (shim_slots[i].win == win) return shim_slots[i].alive;
	}
	return 0;
}

void *shim_window_new(const char *title, int w, int h, int min_w) {
	if (!shim_window_new_fn) return 0;
	// GTK_WINDOW_TOPLEVEL is 0.
	void *win = shim_window_new_fn(0);
	if (!win) return 0;
	if (title && title[0] && shim_set_title) shim_set_title(win, title);
	shim_set_default_size(win, w, h);
	// minWidth arrives as a width request on the window itself, which is what
	// stops a drag narrower than the config allows.
	if (min_w > 0) shim_set_size_request(win, min_w, h);
	if (shim_connect) shim_connect(win, "destroy", shim_on_destroy, 0, 0, 0);
	if (shim_slot_count < 32) {
		shim_slots[shim_slot_count].win = win;
		shim_slots[shim_slot_count].alive = 1;
		shim_slot_count++;
	}
	return win;
}

int shim_window_attach(void *win, void *child) {
	if (!win || !child || !shim_container_add) return 0;
	// GTK_CONTAINER is a cast macro and GtkWindow is a GtkContainer, so the
	// pointer is the same address with no wrapper built.
	shim_container_add(win, child);
	return 1;
}

void shim_window_show(void *win) {
	if (!win || !shim_show_all) return;
	shim_show_all(win);
}

void shim_window_destroy(void *win) {
	if (!win || !shim_destroy) return;
	shim_destroy(win);
	for (int i = 0; i < shim_slot_count; i++) {
		if (shim_slots[i].win == win) shim_slots[i].alive = 0;
	}
}
