// --- Per-view load and eval state ------------------------------------------
// Keyed by the WebKitWebView handle every command already carries, so two views
// answer for themselves. This used to be one process-wide slot, and the comment
// said so: a second view overwrote the first, so `state` answered for whichever
// loaded last. A window that holds an embedded surface beside its own page would
// then read the other document's load as its own.
//
// The record is a fixed table, like the window slots: 32 live views is the
// ceiling, a slot is reused as soon as its view is gone, and creation resets the
// record rather than inheriting whatever a destroyed view left at that address.

#define SHIM_VIEW_STATE_MAX 32
#define SHIM_LOAD_TEXT_MAX 512
#define SHIM_EVAL_TEXT_MAX 1024

// GError as GLib lays it out. Read here, never returned: no struct crosses bun:ffi.
typedef struct {
	unsigned int domain;
	int code;
	char *message;
} ShimGError;

typedef struct {
	void *view;
	int load;
	int eval;
	char load_text[SHIM_LOAD_TEXT_MAX];
	char eval_text[SHIM_EVAL_TEXT_MAX];
} shim_view_state;

static shim_view_state shim_view_states[SHIM_VIEW_STATE_MAX];
static int shim_view_state_count;

// What a reader answers when it holds no record: a cstring needs a terminator,
// and 0 would be a length the caller cannot tell from "not found".
static char shim_view_state_empty[1];

// `create` is the difference between the three signal handlers, which may arrive
// for a view created before this part ran, and a reader, which must never invent
// a record for a handle it does not hold.
static shim_view_state *shim_view_state_for(void *view, int create) {
	if (!view) return 0;
	for (int i = 0; i < shim_view_state_count; i++)
		if (shim_view_states[i].view == view) return &shim_view_states[i];
	if (!create) return 0;
	int slot = -1;
	for (int i = 0; i < shim_view_state_count; i++) {
		if (!shim_view_states[i].view) {
			slot = i;
			break;
		}
	}
	if (slot < 0 && shim_view_state_count < SHIM_VIEW_STATE_MAX) slot = shim_view_state_count++;
	if (slot < 0) return 0;
	shim_view_state *state = &shim_view_states[slot];
	state->view = view;
	state->load = 0;
	state->eval = 0;
	state->load_text[0] = 0;
	state->eval_text[0] = 0;
	return state;
}

void shim_state_register(void *view) { shim_view_state_for(view, 1); }

/** Drop a destroyed view's record and compact the table, so its slot is reusable. */
void shim_state_forget(void *view) {
	if (!view) return;
	for (int i = 0; i < shim_view_state_count; i++) {
		if (shim_view_states[i].view == view) {
			int last = shim_view_state_count - 1;
			if (i != last) shim_view_states[i] = shim_view_states[last];
			shim_view_states[last].view = 0;
			shim_view_states[last].load = 0;
			shim_view_states[last].eval = 0;
			shim_view_states[last].load_text[0] = 0;
			shim_view_states[last].eval_text[0] = 0;
			shim_view_state_count--;
			return;
		}
	}
}

static void shim_state_load_changed(void *view, int event, void *data) {
	(void)data;
	shim_view_state *state = shim_view_state_for(view, 1);
	if (!state) return;
	// A new navigation starts from a clean record. A failure is sticky, because WebKit follows
	// `load-failed` with a FINISHED for its own error page — measured on ubuntu-sandbox, where a
	// missing file reported 0, 4, 3, and the 3 alone would hide the failure.
	if (event == 0) {
		state->load = 0;
		state->load_text[0] = 0;
		return;
	}
	if (state->load == SHIM_LOAD_FAILED) return;
	state->load = event;
}

// The failure this signal exists for: the URI and GLib's own message, printed by
// the caller. FALSE lets WebKit show its error page, which is what an app shows.
static int shim_state_load_failed(void *view, int event, const char *uri, void *error, void *data) {
	(void)event;
	(void)data;
	shim_view_state *state = shim_view_state_for(view, 1);
	if (!state) return 0;
	state->load = SHIM_LOAD_FAILED;
	shim_copy_text(state->load_text, SHIM_LOAD_TEXT_MAX, uri ? uri : "load failed");
	int used = 0;
	while (state->load_text[used]) used++;
	ShimGError *gerror = (ShimGError *)error;
	if (gerror && gerror->message && used < SHIM_LOAD_TEXT_MAX - 12) {
		state->load_text[used++] = ':';
		state->load_text[used++] = ' ';
		shim_copy_text(state->load_text + used, SHIM_LOAD_TEXT_MAX - used, gerror->message);
	}
	return 0;
}

// The answer belongs to the view that asked, which is the GObject the finish call
// takes; a second surface evaluating at the same moment can no longer overwrite it.
static void shim_state_eval_done(void *source, void *result, void *data) {
	(void)data;
	shim_view_state *state = shim_view_state_for(source, 1);
	if (!state) return;
	void *error = 0;
	void *value = 0;
	if (shim_view_eval_finish)
		value = shim_view_eval_finish((WebKitWebView *)source, result, &error);
	if (error) {
		ShimGError *gerror = (ShimGError *)error;
		shim_copy_text(state->eval_text, SHIM_EVAL_TEXT_MAX,
		               gerror->message ? gerror->message : "evaluate failed");
		// The GError is caller-owned and a failed finish may also hand back a
		// value. Free both here, the same way the success path does, or a page
		// that keeps throwing scripts leaks one GLib allocation per evaluation.
		if (value && shim_object_unref) shim_object_unref(value);
		if (shim_g_error_free) shim_g_error_free(error);
		state->eval = 2;
		return;
	}
	char *text = (value && shim_jsc_to_string) ? shim_jsc_to_string(value) : 0;
	shim_copy_text(state->eval_text, SHIM_EVAL_TEXT_MAX, text ? text : "");
	// g_free, never free: Bun links mimalloc, so the shim's `free` resolves to it and handing it a
	// GLib string read an allocator header from a foreign block and faulted (address 0xA6D0,
	// measured on ubuntu-sandbox). The string is GLib's, so only GLib's own free fits.
	if (text && shim_g_free) shim_g_free(text);
	if (value && shim_object_unref) shim_object_unref(value);
	state->eval = 1;
}

void shim_state_reset_eval(void *view) {
	shim_view_state *state = shim_view_state_for(view, 1);
	if (!state) return;
	state->eval = 0;
	state->eval_text[0] = 0;
}

// 0 started, 1 redirected, 2 committed, 3 finished, 4 failed. A handle with no
// record answers started, which is what a view that never loaded reports.
int shim_webview_load_state(void *web) {
	shim_view_state *state = shim_view_state_for(web, 0);
	return state ? state->load : 0;
}

const char *shim_webview_load_text(void *web) {
	shim_view_state *state = shim_view_state_for(web, 0);
	return state ? state->load_text : shim_view_state_empty;
}

// 0 pending, 1 answered, 2 threw. The answer is text because it left C as bytes.
int shim_webview_eval_state(void *web) {
	shim_view_state *state = shim_view_state_for(web, 0);
	return state ? state->eval : 0;
}

const char *shim_webview_eval_text(void *web) {
	shim_view_state *state = shim_view_state_for(web, 0);
	return state ? state->eval_text : shim_view_state_empty;
}
