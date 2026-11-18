// --- `crust:tray` on Linux, over GtkStatusIcon -----------------------------
// `GtkStatusIcon` is deprecated in GTK 3 and still ships there, and GTK 3 is the version this layer
// targets (`libgtk-3.so.0`, the same handle the window shim opens). The alternative, an
// `AppIndicator`, would add a second library (`libayatana-appindicator3.so.1`) and still take a
// `GtkMenu`, so the deprecated-but-present class is the smaller dependency and the one that works on
// a plain GTK3 desktop with no extra package. GTK 4 removed `GtkStatusIcon`: a GTK4 port needs the
// AppIndicator path, and that is stated here rather than discovered later.
//
// One translation unit with `80_notify.c`, so the copy helper, the reason buffer and `shim_sym` are
// the same objects. GTK is opened here, separately from libnotify, because a machine can have one
// and not the other.

#define SHIM_TRAY_MAX 12
#define SHIM_LABEL_MAX 96

static void *g_gtk;
static int g_gtk_state;
static GtkStatusIcon *g_icon;
static void *g_menu;
static int g_click = -1;
static char g_labels[SHIM_TRAY_MAX][SHIM_LABEL_MAX];
static int g_label_count;

static GtkStatusIcon *(*gtk_status_icon_new_from_icon_name)(const char *name);
static void (*gtk_status_icon_set_tooltip_text)(GtkStatusIcon *icon, const char *text);
static void (*gtk_status_icon_set_visible)(GtkStatusIcon *icon, int visible);
static void *(*gtk_menu_new)(void);
static void *(*gtk_menu_item_new_with_label)(const char *label);
static void (*gtk_menu_shell_append)(void *shell, void *item);
static void (*gtk_widget_show_all)(void *widget);
static void (*gtk_widget_destroy)(void *widget);
static void (*gtk_menu_popup_at_pointer)(void *menu, const void *event);
static unsigned long (*g_signal_connect_data)(void *instance, const char *signal, void *handler,
                                              void *data, void *destroy, int flags);
static void (*gtk_object_unref)(GObject *object);

// 1 when GTK resolved every entry point; 0 with the gap named by `shim_notify_missing`.
int shim_tray_load(void) {
	if (g_gtk_state) return g_gtk_state > 0;
	g_gtk_state = -1;
	g_gtk = dlopen("libgtk-3.so.0", SHIM_RTLD_NOW | SHIM_RTLD_GLOBAL);
	if (!g_gtk) {
		shim_copy(g_missing, 64, "libgtk-3.so.0");
		return 0;
	}
	if (!shim_sym(g_gtk, "gtk_status_icon_new_from_icon_name",
	              (void **)&gtk_status_icon_new_from_icon_name))
		return 0;
	if (!shim_sym(g_gtk, "gtk_status_icon_set_tooltip_text",
	              (void **)&gtk_status_icon_set_tooltip_text))
		return 0;
	if (!shim_sym(g_gtk, "gtk_status_icon_set_visible", (void **)&gtk_status_icon_set_visible))
		return 0;
	if (!shim_sym(g_gtk, "gtk_menu_new", (void **)&gtk_menu_new)) return 0;
	if (!shim_sym(g_gtk, "gtk_menu_item_new_with_label", (void **)&gtk_menu_item_new_with_label))
		return 0;
	if (!shim_sym(g_gtk, "gtk_menu_shell_append", (void **)&gtk_menu_shell_append)) return 0;
	if (!shim_sym(g_gtk, "gtk_widget_show_all", (void **)&gtk_widget_show_all)) return 0;
	if (!shim_sym(g_gtk, "gtk_widget_destroy", (void **)&gtk_widget_destroy)) return 0;
	// GTK 3.22 (2016) is the floor for this one. An older GTK refuses `tray.setMenu` by name rather
	// than opening a menu at 0,0 that never dismisses.
	if (!shim_sym(g_gtk, "gtk_menu_popup_at_pointer", (void **)&gtk_menu_popup_at_pointer)) return 0;
	if (!shim_sym(g_gtk, "g_signal_connect_data", (void **)&g_signal_connect_data)) return 0;
	if (!shim_sym(g_gtk, "g_object_unref", (void **)&gtk_object_unref)) return 0;
	g_gtk_state = 1;
	return 1;
}

int shim_tray_ready(void) { return shim_tray_load(); }

// A menu row was chosen. `data` is the one-based index, because NULL means "no data" to GTK.
static void shim_tray_on_item(void *item, void *data) {
	(void)item;
	g_click = (int)(long long)data - 1;
}

// The icon was right-clicked. `GtkStatusIcon`'s "popup-menu" passes (icon, button, time); this
// handler takes all four so no ABI trick is needed to drop the extras.
static void shim_tray_on_popup(void *icon, unsigned int button, unsigned int when, void *data) {
	(void)icon;
	(void)button;
	(void)when;
	(void)data;
	if (g_menu) gtk_menu_popup_at_pointer(g_menu, 0);
}

// The status icon, created once. The contract has no icon member — `TrayOptions.icon` belongs to the
// draft `set` call and nothing reads it — so the theme's generic application icon is what shows.
static int shim_tray_icon(void) {
	if (g_icon) return 1;
	g_icon = gtk_status_icon_new_from_icon_name("application-x-executable");
	if (!g_icon) {
		shim_reason("gtk_status_icon_new_from_icon_name returned NULL", "no icon theme is installed");
		return 0;
	}
	// "popup-menu" is the right-click; the connect is what makes the menu reachable at all.
	g_signal_connect_data(g_icon, "popup-menu", (void *)shim_tray_on_popup, 0, 0, 0);
	return 1;
}

// The labels, one per line, in the order the plugin sent them. An empty list detaches the menu.
int shim_tray_menu(const char *joined, int count) {
	if (!shim_tray_load() || !shim_tray_icon()) return 0;
	if (g_menu) {
		gtk_widget_destroy(g_menu);
		g_menu = 0;
	}
	g_label_count = 0;
	if (!joined || count <= 0) return 1;
	int index = 0;
	int i = 0;
	while (joined[i] && index < SHIM_TRAY_MAX) {
		int n = 0;
		while (joined[i] && joined[i] != '\n' && n < SHIM_LABEL_MAX - 1) {
			g_labels[index][n++] = joined[i++];
		}
		g_labels[index][n] = 0;
		while (joined[i] && joined[i] != '\n') i++; // an over-long label keeps its first 95 bytes
		if (joined[i] == '\n') i++;
		index++;
	}
	g_menu = gtk_menu_new();
	if (!g_menu) {
		shim_reason("gtk_menu_new returned NULL", "out of memory");
		return 0;
	}
	for (int row = 0; row < index; row++) {
		void *item = gtk_menu_item_new_with_label(g_labels[row]);
		if (!item) continue;
		g_signal_connect_data(item, "activate", (void *)shim_tray_on_item,
		                      (void *)(long long)(row + 1), 0, 0);
		gtk_menu_shell_append(g_menu, item);
	}
	gtk_widget_show_all(g_menu);
	g_label_count = index;
	return 1;
}

// The hover text, which is the only place a status icon can carry text at all.
int shim_tray_tooltip(const char *text) {
	if (!shim_tray_load() || !shim_tray_icon()) return 0;
	gtk_status_icon_set_tooltip_text(g_icon, text ? text : "");
	shim_reason("the tooltip is set", "gtk_status_icon_set_tooltip_text");
	return 1;
}

int shim_tray_show(void) {
	if (!shim_tray_load() || !shim_tray_icon()) return 0;
	gtk_status_icon_set_visible(g_icon, 1);
	return 1;
}

// The icon object stays, hidden: a later `show` is one call rather than a second registration.
int shim_tray_hide(void) {
	if (!shim_tray_load()) return 0;
	if (!g_icon) return 1;
	gtk_status_icon_set_visible(g_icon, 0);
	return 1;
}

// Everything goes: the menu, the icon object, the labels. A `show` after this builds them again.
int shim_tray_destroy(void) {
	if (!shim_tray_load()) return 0;
	if (g_menu) {
		gtk_widget_destroy(g_menu);
		g_menu = 0;
	}
	if (g_icon) {
		gtk_object_unref((GObject *)g_icon);
		g_icon = 0;
	}
	g_label_count = 0;
	g_click = -1;
	return 1;
}

// The row clicked since the last call, or -1. Cleared as it is read, because a GTK signal is not a
// JavaScript callback: the adapter polls, and the pump that makes the menu reachable is GTK's own.
int shim_tray_click(void) {
	int index = g_click;
	g_click = -1;
	return index;
}
