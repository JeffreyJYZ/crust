// --- the file panels: the calls --------------------------------------------
// Split from `83_dialog.c` at the line cap, along the seam that matters: that part owns the entry
// points and the answer state, this one owns starting, reading and ending a panel. Every static it
// touches is declared there, which is why the two are adjacent in the unit.

// `Name|*.txt;*.md\nImages|*.png` -> one GtkFileFilter per group. A group with no pattern adds no
// filter at all: an empty pattern matches every file, which is the fake filter this layer refuses.
static void shim_dlg_filters(const char *src) {
	int i = 0;
	if (!src || !src[0] || !shim_dlg_filter_new || !shim_dlg_add_filter) return;
	while (src[i]) {
		char name[SHIM_DIALOG_FIELD];
		int f = 0;
		void *filter;
		while (src[i] && src[i] != '|' && src[i] != '\n' && f < SHIM_DIALOG_FIELD - 1)
			name[f++] = src[i++];
		name[f] = 0;
		if (src[i] == '|') i++;
		filter = shim_dlg_filter_new();
		if (!filter) return;
		if (f > 0 && shim_dlg_filter_name) shim_dlg_filter_name(filter, name);
		while (src[i] && src[i] != '\n') {
			char pattern[SHIM_DIALOG_FIELD];
			int p = 0;
			while (src[i] && src[i] != ';' && src[i] != '\n' && p < SHIM_DIALOG_FIELD - 1)
				pattern[p++] = src[i++];
			pattern[p] = 0;
			if (p > 0 && shim_dlg_filter_pattern) shim_dlg_filter_pattern(filter, pattern);
			if (src[i] == ';') i++;
		}
		if (src[i] == '\n') i++;
		shim_dlg_add_filter(g_dlg_dialog, filter);
		if (shim_dlg_object_unref) shim_dlg_object_unref(filter);
	}
}

// Destroy the dialog that is up, if any. The response handler never does this itself.
void shim_dialog_release(void) {
	if (g_dlg_dialog && shim_dlg_destroy) shim_dlg_destroy(g_dlg_dialog);
	g_dlg_dialog = 0;
	g_dlg_state = SHIM_DIALOG_IDLE;
}

// Start one panel. 1 started, -2 an entry point did not resolve, -3 GTK refused to build it.
static int shim_dlg_start(const char *title, const char *filters, const char *suggested, int action,
                          int multiple, void *parent) {
	if (!shim_dialog_ready()) return -2;
	shim_dialog_release();
	g_dlg_count = 0;
	g_dlg_dialog = shim_dlg_new(title && title[0] ? title : 0, parent, action, 0, 0);
	if (!g_dlg_dialog) return -3;
	if (multiple && shim_dlg_multiple) shim_dlg_multiple(g_dlg_dialog, 1);
	if (suggested && suggested[0] && shim_dlg_current_name)
		shim_dlg_current_name(g_dlg_dialog, suggested);
	shim_dlg_filters(filters);
	shim_dlg_connect(g_dlg_dialog, "response", (void *)shim_dlg_response, 0, 0, 0);
	g_dlg_state = SHIM_DIALOG_PENDING;
	shim_dlg_show(g_dlg_dialog);
	return 1;
}

int shim_dialog_open(const char *title, const char *filters, int multiple, int directory,
                     void *parent) {
	// GTK_FILE_CHOOSER_ACTION_OPEN is 0 and SELECT_FOLDER is 2.
	return shim_dlg_start(title, filters, 0, directory ? 2 : 0, multiple, parent);
}

int shim_dialog_save(const char *title, const char *suggested, const char *filters, void *parent) {
	// GTK_FILE_CHOOSER_ACTION_SAVE is 1. The name is a suggestion, never a path.
	return shim_dlg_start(title, filters, suggested, 1, 0, parent);
}

// 0 idle, 1 pending, 2 accepted, 3 cancelled — read between pump slices, on the thread GTK answers on.
int shim_dialog_status(void) { return g_dlg_state; }

int shim_dialog_count(void) { return g_dlg_count; }

const char *shim_dialog_path(int index) {
	if (index < 0 || index >= g_dlg_count) return "";
	return g_dlg_paths[index];
}

// End the panel the way its Cancel button would. 1 when one was up, 0 when nothing was pending —
// which is an ordinary race with the human's own click, never an error.
int shim_dialog_cancel(void) {
	if (g_dlg_state != SHIM_DIALOG_PENDING || !g_dlg_dialog) return 0;
	if (shim_dlg_hide) shim_dlg_hide(g_dlg_dialog);
	g_dlg_state = SHIM_DIALOG_CANCELLED;
	return 1;
}
