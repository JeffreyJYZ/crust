// --- opener ----------------------------------------------------------------
// `g_app_info_launch_default_for_uri`: GIO's association lookup, which is what a double-click does.
// A URL goes straight through; a path becomes a `file://` URI through `g_filename_to_uri`, which is
// the escaping GLib owns — building "file://" + path by hand breaks on every space, `#` and
// non-ASCII byte a real filename contains.
//
// Resolved lazily with `shim_sym_or_null` from the GTK handle: GIO is one of GTK's own dependencies,
// so `dlsym` on that handle finds these without a second `dlopen`.
//
// **`revealItem` has no Linux answer and is refused in TypeScript, not here.** No desktop has a
// standard "select this file in the file manager" call — the D-Bus interfaces differ per file
// manager — so opening the containing folder is a different verb and pretending otherwise would be
// the silent wrong answer.

static int (*shim_g_app_info_launch)(const char *uri, void *context, void **error);
static char *(*shim_g_filename_to_uri)(const char *filename, const char *host, void **error);
static int shim_opener_resolved;
static char shim_opener_reason[256];

static void shim_opener_note(const char *text) {
	int i = 0;
	if (text) {
		while (text[i] && i < 250) {
			shim_opener_reason[i] = text[i];
			i++;
		}
	}
	shim_opener_reason[i] = 0;
}

// Why the last send ended as it did, naming the call that refused.
const char *shim_opener_reason_text(void) { return shim_opener_reason; }

static void shim_opener_resolve(void) {
	if (shim_opener_resolved) return;
	void *h = shim_gtk_handle();
	shim_opener_resolved = 1;
	if (!h) return;
	shim_g_app_info_launch = shim_sym_or_null(h, "g_app_info_launch_default_for_uri");
	shim_g_filename_to_uri = shim_sym_or_null(h, "g_filename_to_uri");
	if (!shim_core_g_free) shim_core_g_free = shim_sym_or_null(h, "g_free");
}

// 1 when GIO's two entry points resolved; 0 names a GTK whose GIO cannot launch anything.
int shim_opener_ready(void) {
	shim_opener_resolve();
	return shim_g_app_info_launch && shim_g_filename_to_uri ? 1 : 0;
}

// One launch, with the URI already built. 1 handed to GIO, 0 refused with a reason.
static int shim_opener_launch(const char *uri) {
	if (!shim_opener_ready()) {
		shim_opener_note("g_app_info_launch_default_for_uri did not resolve from libgtk-3.so.0");
		return 0;
	}
	if (!uri || !uri[0]) {
		shim_opener_note("the URI was empty, so there was nothing to launch");
		return 0;
	}
	// A NULL GError pointer is legal and keeps the failure to one bit: GIO answered FALSE, and the
	// message would be its own wording of a missing association, which the reason line names better.
	if (shim_g_app_info_launch(uri, 0, 0)) {
		shim_opener_note("");
		return 1;
	}
	shim_opener_note("g_app_info_launch_default_for_uri answered FALSE — no handler for that URI");
	return 0;
}

// 1 handed to GIO, 0 refused. The bytes are already NUL-terminated by `cstring`; the length is the
// same argument every opener entry point takes, so the Windows and Linux halves keep one shape.
int shim_opener_open_url(const char *bytes, int length) {
	(void)length;
	return shim_opener_launch(bytes);
}

// A path becomes a `file://` URI through GLib, then takes the same launch: the escaping is GLib's,
// never a concatenation here.
int shim_opener_open_path(const char *bytes, int length) {
	(void)length;
	if (!shim_opener_ready()) {
		shim_opener_note("g_filename_to_uri did not resolve from libgtk-3.so.0");
		return 0;
	}
	char *uri = shim_g_filename_to_uri(bytes, 0, 0);
	if (!uri) {
		shim_opener_note("g_filename_to_uri refused the path, so no file:// URI was built");
		return 0;
	}
	int launched = shim_opener_launch(uri);
	if (shim_core_g_free) shim_core_g_free(uri);
	return launched;
}
