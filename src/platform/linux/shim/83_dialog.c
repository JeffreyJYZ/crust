// --- the file panels -------------------------------------------------------
// GtkFileChooserNative, shown with `gtk_native_dialog_show` and answered through its "response"
// signal. NOT `gtk_dialog_run` / `gtk_native_dialog_run`: those run a nested GMainLoop on the calling
// thread, which here is Bun's main thread — the same thread every pump slice runs on — so JavaScript
// would be frozen for as long as the panel was up and `dialog.cancel` could never answer. `show`
// returns at once and the signal arrives inside a normal `g_main_context_iteration` slice, which is
// the shape the darwin sheet already has and the reason this layer keeps the pump alive.
//
// The nested loop would not have deadlocked: it iterates the same default GMainContext the pump
// iterates, and nothing here caches context state. It would simply have blocked every timer, which
// is the worse trade for an API that can avoid it.
//
// Every entry point is resolved optionally with `shim_sym_or_null` and named by
// `shim_dialog_missing`, because GtkFileChooserNative arrived in GTK 3.20: a machine with an older
// GTK must still launch an app, and this namespace alone answers by name — the rule
// `45_window_api.c` follows, and why these are not PREFLIGHT entries that would fail a launch.

#define SHIM_DIALOG_MAX 16
#define SHIM_DIALOG_PATH 1024
#define SHIM_DIALOG_FIELD 256

#define SHIM_DIALOG_IDLE 0
#define SHIM_DIALOG_PENDING 1
#define SHIM_DIALOG_ACCEPTED 2
#define SHIM_DIALOG_CANCELLED 3

// GTK's own answers: accept is -3, cancel -6, and a closed window arrives as delete-event (-4).
#define SHIM_RESPONSE_ACCEPT (-3)

static void *g_dlg_dialog;
static int g_dlg_state;
static int g_dlg_count;
static char g_dlg_paths[SHIM_DIALOG_MAX][SHIM_DIALOG_PATH];
static char g_dlg_missing[128];

static void *(*shim_dlg_new)(const char *, void *, int, const char *, const char *);
static void (*shim_dlg_show)(void *);
static void (*shim_dlg_hide)(void *);
static void (*shim_dlg_destroy)(void *);
static void (*shim_dlg_multiple)(void *, int);
static void (*shim_dlg_current_name)(void *, const char *);
static void *(*shim_dlg_filenames)(void *);
static void (*shim_dlg_add_filter)(void *, void *);
static void *(*shim_dlg_filter_new)(void);
static void (*shim_dlg_filter_name)(void *, const char *);
static void (*shim_dlg_filter_pattern)(void *, const char *);
static void (*shim_dlg_object_unref)(void *);
static void (*shim_dlg_free)(void *);
static void (*shim_dlg_slist_free)(void *);
static unsigned long (*shim_dlg_connect)(void *, const char *, void *, void *, void *, int);

// The first entry point that did not resolve, or "" when the panels are usable. Recorded once, so a
// refusal names one symbol instead of repeating the whole list.
static int shim_dlg_bind(void *gtk, const char *name, void **slot) {
	*slot = shim_sym_or_null(gtk, name);
	if (*slot) return 1;
	if (!g_dlg_missing[0]) {
		int i = 0;
		while (name[i] && i < 120) {
			g_dlg_missing[i] = name[i];
			i++;
		}
		g_dlg_missing[i] = 0;
	}
	return 0;
}

static int shim_dlg_ready_state;
int shim_dialog_ready(void) {
	void *gtk;
	int ok = 1;
	if (shim_dlg_ready_state) return shim_dlg_ready_state > 0;
	shim_dlg_ready_state = -1;
	if (!shim_lib_open()) return 0;
	gtk = shim_gtk_handle();
	g_dlg_missing[0] = 0;
	ok &= shim_dlg_bind(gtk, "gtk_file_chooser_native_new", (void **)&shim_dlg_new);
	ok &= shim_dlg_bind(gtk, "gtk_native_dialog_show", (void **)&shim_dlg_show);
	ok &= shim_dlg_bind(gtk, "gtk_native_dialog_hide", (void **)&shim_dlg_hide);
	ok &= shim_dlg_bind(gtk, "gtk_native_dialog_destroy", (void **)&shim_dlg_destroy);
	ok &= shim_dlg_bind(gtk, "gtk_file_chooser_set_select_multiple", (void **)&shim_dlg_multiple);
	ok &= shim_dlg_bind(gtk, "gtk_file_chooser_set_current_name", (void **)&shim_dlg_current_name);
	ok &= shim_dlg_bind(gtk, "gtk_file_chooser_get_filenames", (void **)&shim_dlg_filenames);
	ok &= shim_dlg_bind(gtk, "gtk_file_chooser_add_filter", (void **)&shim_dlg_add_filter);
	ok &= shim_dlg_bind(gtk, "gtk_file_filter_new", (void **)&shim_dlg_filter_new);
	ok &= shim_dlg_bind(gtk, "gtk_file_filter_set_name", (void **)&shim_dlg_filter_name);
	ok &= shim_dlg_bind(gtk, "gtk_file_filter_add_pattern", (void **)&shim_dlg_filter_pattern);
	ok &= shim_dlg_bind(gtk, "g_object_unref", (void **)&shim_dlg_object_unref);
	ok &= shim_dlg_bind(gtk, "g_free", (void **)&shim_dlg_free);
	ok &= shim_dlg_bind(gtk, "g_slist_free", (void **)&shim_dlg_slist_free);
	ok &= shim_dlg_bind(gtk, "g_signal_connect_data", (void **)&shim_dlg_connect);
	if (!ok) return 0;
	shim_dlg_ready_state = 1;
	return 1;
}

const char *shim_dialog_missing(void) {
	if (shim_dialog_ready()) return "";
	return g_dlg_missing;
}

// Bounded copy of one GLib string into the static answer table, so no GLib pointer crosses bun:ffi.
static void shim_dlg_copy(const char *src, char *dst) {
	int i = 0;
	if (!src) {
		dst[0] = 0;
		return;
	}
	while (src[i] && i < SHIM_DIALOG_PATH - 1) {
		dst[i] = src[i];
		i++;
	}
	dst[i] = 0;
}

// One picked path per node of the GSList, in the order GTK answered them. Every string and the list
// itself are GLib allocations, so they go back through g_free / g_slist_free — never `free`.
static void shim_dlg_collect(void *dialog) {
	void *head;
	void *node;
	g_dlg_count = 0;
	if (!shim_dlg_filenames) return;
	head = shim_dlg_filenames(dialog);
	node = head;
	while (node && g_dlg_count < SHIM_DIALOG_MAX) {
		char *name = ((char **)node)[0];
		if (name) {
			shim_dlg_copy(name, g_dlg_paths[g_dlg_count]);
			if (g_dlg_paths[g_dlg_count][0]) g_dlg_count++;
			if (shim_dlg_free) shim_dlg_free(name);
		}
		node = ((void **)node)[1];
	}
	if (head && shim_dlg_slist_free) shim_dlg_slist_free(head);
}

// The answer GTK hands the signal. Recorded, never acted on: destroying the dialog inside its own
// handler is what GTK forbids, so the caller releases it after reading the state.
static void shim_dlg_response(void *dialog, int response, void *data) {
	(void)data;
	if (response == SHIM_RESPONSE_ACCEPT) {
		shim_dlg_collect(dialog);
		g_dlg_state = SHIM_DIALOG_ACCEPTED;
		return;
	}
	// Cancel and a closed window are both "the human said no": an ordinary answer, never an error.
	g_dlg_state = SHIM_DIALOG_CANCELLED;
}
