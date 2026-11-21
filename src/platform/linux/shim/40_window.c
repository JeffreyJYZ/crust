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

// The positioned container, defined in the part below: a window holds one
// container, and the app's own webview is attached through it so a surface has
// somewhere to be placed. Forward-declared because the window arrives first.
void *shim_window_container(void *win);
void shim_container_forget(void *win);

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
// destroy signal clears its slot here, and `window(label)` reads the table.
// 32 slots is the ceiling on *simultaneously* tracked windows — a slot is reused
// as soon as its window dies, so opening and closing more than 32 over a process
// lifetime cannot leave a live window untracked.
typedef struct {
	void *win;
	int alive;
} shim_slot;

static shim_slot shim_slots[32];
static int shim_slot_count;

static void shim_slot_release(void *win) {
	if (!win) return;
	for (int i = 0; i < shim_slot_count; i++) {
		if (shim_slots[i].win == win) {
			shim_slots[i].win = 0;
			shim_slots[i].alive = 0;
			return;
		}
	}
}

static void shim_on_destroy(void *widget, void *data) {
	(void)data;
	shim_slot_release(widget);
	shim_container_forget(widget);
}

int shim_window_alive(void *win) {
	if (!win) return 0;
	for (int i = 0; i < shim_slot_count; i++) {
		if (shim_slots[i].win == win) return shim_slots[i].alive;
	}
	return 0;
}

void *shim_window_new(const char *title, int w, int h, int min_w, int min_h) {
	if (!shim_window_new_fn) return 0;
	// GTK_WINDOW_TOPLEVEL is 0.
	void *win = shim_window_new_fn(0);
	if (!win) return 0;
	if (title && title[0] && shim_set_title) shim_set_title(win, title);
	shim_set_default_size(win, w, h);
	// Each minimum arrives as a size request on the window itself, which is what
	// stops a drag below what the config allows. -1 is GTK's "no request" on an
	// axis: 0 would be a real floor of zero, which is not the same thing, and the
	// opening height must never become a height floor.
	if (min_w > 0 || min_h > 0)
		shim_set_size_request(win, min_w > 0 ? min_w : -1, min_h > 0 ? min_h : -1);
	if (shim_connect) shim_connect(win, "destroy", shim_on_destroy, 0, 0, 0);
	// Reuse a released slot first; grow only while every slot is taken. A stale
	// pointer no longer matches any slot, so `shim_window_alive` answers 0 for it.
	int slot = -1;
	for (int i = 0; i < shim_slot_count; i++) {
		if (!shim_slots[i].win) {
			slot = i;
			break;
		}
	}
	if (slot < 0 && shim_slot_count < 32) slot = shim_slot_count++;
	if (slot >= 0) {
		shim_slots[slot].win = win;
		shim_slots[slot].alive = 1;
	}
	return win;
}

int shim_window_attach(void *win, void *child) {
	if (!win || !child || !shim_container_add) return 0;
	// The app's own webview goes into the window's container, not the window: a
	// GtkWindow holds one child, and that slot belongs to the container so a
	// surface opened later has somewhere to be placed over the page.
	void *box = shim_window_container(win);
	if (!box) return 0;
	// `gtk_container_add` on the container is its main child, which fills the window.
	shim_container_add(box, child);
	return 1;
}

void shim_window_show(void *win) {
	if (!win || !shim_show_all) return;
	shim_show_all(win);
}

void shim_window_destroy(void *win) {
	if (!win || !shim_destroy) return;
	shim_destroy(win);
	// `shim_destroy` emits the destroy signal, but release explicitly too: a
	// handler that was never connected must not leave the slot occupied.
	shim_slot_release(win);
	shim_container_forget(win);
}
