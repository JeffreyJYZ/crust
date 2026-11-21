// --- snapshot: WebKitGTK's own render of the page ---------------------------
// `webkit_web_view_get_snapshot` is asynchronous: the callback runs on the main context the pump
// iterates, and the picture arrives as a cairo surface we encode to PNG in memory. Nothing here
// reads the display, so no screen grab, no focus and no Screen Recording grant is involved — the
// same reason the macOS half snapshots the WKWebView itself. Every entry point is resolved lazily
// through the handles the prelude opened, so a WebKitGTK without the snapshot API fails one named
// `ready` check instead of refusing to launch the app.

typedef void (*ShimSnapshotStart)(void *, int, int, void *, void (*)(void *, void *, void *), void *);
typedef void *(*ShimSnapshotFinish)(void *, void *, void **);
typedef int (*ShimCairoWriteFunc)(void *, const unsigned char *, unsigned int);
typedef int (*ShimCairoWrite)(void *, ShimCairoWriteFunc, void *);
typedef void (*ShimCairoDestroy)(void *);
typedef int (*ShimWidgetInt)(void *);
typedef struct { unsigned int domain; int code; char *message; } ShotGError;

// cairo is its own soname, a dependency of WebKitGTK. Resolving cairo entry points through the
// WebKit handle is not enough on Ubuntu: dlsym does not surface them there, so we open cairo by
// name and resolve from its handle. One handle for the process, opened on the first snapshot.
static void *shim_cairo;
static ShimSnapshotStart shim_snapshot_start;
static ShimSnapshotFinish shim_snapshot_finish;
static ShimCairoWrite shim_cairo_write_png;
static ShimCairoDestroy shim_cairo_destroy;
static ShimWidgetInt shim_widget_realized;
static ShimWidgetInt shim_widget_scale;
static int shim_snapshot_resolved;
static int shim_snapshot_missing;

// The result of one capture, filled entirely in the main-context callback before JS is told.
static unsigned char *shot_bytes;
static long shot_len;
static long shot_cap;
static long shot_w;
static long shot_h;
static double shot_scale;
static int shot_state; // 0 pending, 1 picture, 2 refusal
static char shot_error[256];
// A late callback for a superseded take must not publish into the next capture's result.
static unsigned long shot_generation;
static unsigned long shot_current;
static unsigned long shot_result_gen;

enum { SHOT_STARTED = 0, SHOT_UNAVAILABLE = 1, SHOT_NO_VIEW = 2, SHOT_NOT_REALISED = 3 };

static void shim_copy_shot_error(const char *what) {
	int i = 0;
	while (what && what[i] && i < (int)sizeof(shot_error) - 1) {
		shot_error[i] = what[i];
		i++;
	}
	shot_error[i] = 0;
}

// Resolved once. WebKit and GTK come from the prelude's handles; cairo is its own soname and must
// be opened by name, because dlsym on WebKit does not surface its entry points on Ubuntu.
static int shim_snapshot_resolve(void) {
	void *w;
	void *g;
	if (shim_snapshot_resolved) return !shim_snapshot_missing;
	shim_snapshot_resolved = 1;
	w = shim_webkit_handle();
	g = shim_gtk_handle();
	if (!shim_cairo) shim_cairo = shim_open("libcairo.so.2");
	shim_snapshot_start = (ShimSnapshotStart)shim_sym_or_null(w, "webkit_web_view_get_snapshot");
	shim_snapshot_finish =
	    (ShimSnapshotFinish)shim_sym_or_null(w, "webkit_web_view_get_snapshot_finish");
	shim_cairo_write_png =
	    (ShimCairoWrite)shim_sym_or_null(shim_cairo, "cairo_surface_write_to_png_stream");
	// The dimensions come from the PNG's IHDR, not cairo_surface_get_width: Ubuntu's libcairo does
	// not export those two symbols, and the PNG is the honest source of the picture's size anyway.
	shim_cairo_destroy = (ShimCairoDestroy)shim_sym_or_null(shim_cairo, "cairo_surface_destroy");
	shim_widget_realized = (ShimWidgetInt)shim_sym_or_null(g, "gtk_widget_get_realized");
	shim_widget_scale = (ShimWidgetInt)shim_sym_or_null(g, "gtk_widget_get_scale_factor");
	// Name the first absent entry point, so a refusal says which library is too old rather than
	// leaving the caller to guess which of the seven lazy symbols was nil.
	shim_snapshot_missing = 0;
	if (!shim_cairo) {
		shim_set_error("snapshot: cannot load", "libcairo.so.2");
		shim_snapshot_missing = 1;
	} else if (!shim_snapshot_start) {
		shim_set_error("snapshot: missing symbol", "webkit_web_view_get_snapshot");
		shim_snapshot_missing = 1;
	} else if (!shim_snapshot_finish) {
		shim_set_error("snapshot: missing symbol", "webkit_web_view_get_snapshot_finish");
		shim_snapshot_missing = 1;
	} else if (!shim_cairo_write_png) {
		shim_set_error("snapshot: missing symbol", "cairo_surface_write_to_png_stream");
		shim_snapshot_missing = 1;
	} else if (!shim_cairo_destroy) {
		shim_set_error("snapshot: missing symbol", "cairo_surface_destroy");
		shim_snapshot_missing = 1;
	} else if (!shim_widget_realized) {
		shim_set_error("snapshot: missing symbol", "gtk_widget_get_realized");
		shim_snapshot_missing = 1;
	}
	return !shim_snapshot_missing;
}

int shim_snapshot_ready(void) { return shim_snapshot_resolve() ? 1 : 0; }

// cairo's write callback: append into a buffer we own, growing by doubling. `free` here is safe —
// these bytes came from our malloc, never from a GLib allocation.
static int shim_snapshot_write(void *closure, const unsigned char *data, unsigned int length) {
	long i;
	(void)closure;
	if (length == 0) return 0; // CAIRO_STATUS_SUCCESS
	if (shot_len + length > shot_cap) {
		long need = shot_len + length;
		long cap = shot_cap > 0 ? shot_cap : 65536;
		unsigned char *next;
		while (cap < need) cap *= 2;
		next = (unsigned char *)malloc(cap);
		if (!next) return 1; // CAIRO_STATUS_NO_MEMORY
		for (i = 0; i < shot_len; i++) next[i] = shot_bytes[i];
		if (shot_bytes) free(shot_bytes);
		shot_bytes = next;
		shot_cap = cap;
	}
	for (i = 0; i < (long)length; i++) shot_bytes[shot_len++] = data[i];
	return 0;
}

// Runs on the main context. The surface is finished, encoded and freed before the state is set, so
// a JS reader that sees state 1 reads one complete picture, never a half-written one.
static void shim_snapshot_done(void *source, void *result, void *user_data) {
	unsigned long gen = (unsigned long)user_data;
	void *error = 0;
	void *surface = 0;
	int status;
	ShotGError *gerror;
	// A take that timed out in JS is superseded; its late answer must not write this result.
	if (gen != shot_current) return;
	shot_result_gen = gen;
	shot_len = 0;
	if (shim_snapshot_finish) surface = shim_snapshot_finish(source, result, &error);
	if (error) {
		gerror = (ShotGError *)error;
		shim_copy_shot_error(gerror && gerror->message ? gerror->message : "snapshot failed");
		if (shim_g_error_free) shim_g_error_free(error);
	}
	if (!error && surface) {
		shot_scale = shim_widget_scale ? (double)shim_widget_scale(source) : 1.0;
		status = shim_cairo_write_png(surface, shim_snapshot_write, 0);
		if (shim_cairo_destroy) shim_cairo_destroy(surface);
		// IHDR: 8-byte signature, 4-byte length, "IHDR", then big-endian width and height. Read
		// from the picture itself, so the reported size is the bitmap WebKit actually rendered.
		if (shot_len >= 24) {
			shot_w = (long)(((unsigned long)shot_bytes[16] << 24) |
			                ((unsigned long)shot_bytes[17] << 16) | ((unsigned long)shot_bytes[18] << 8) |
			                (unsigned long)shot_bytes[19]);
			shot_h = (long)(((unsigned long)shot_bytes[20] << 24) |
			                ((unsigned long)shot_bytes[21] << 16) | ((unsigned long)shot_bytes[22] << 8) |
			                (unsigned long)shot_bytes[23]);
		}
		if (status == 0 && shot_len > 0 && shot_w > 0 && shot_h > 0) shot_state = 1;
		else shim_copy_shot_error("WebKit rendered no PNG");
	} else {
		if (surface && shim_cairo_destroy) shim_cairo_destroy(surface);
		if (!error) shim_copy_shot_error("WebKit took no snapshot");
	}
	if (shot_state == 0) shot_state = 2;
}

// 0 started, 1 no API, 2 no view, 3 view not realised. Only 0 means a picture is on its way.
int shim_snapshot_take(void *web) {
	if (!shim_snapshot_resolve()) return SHOT_UNAVAILABLE;
	if (!web) return SHOT_NO_VIEW;
	if (shim_widget_realized && !shim_widget_realized(web)) return SHOT_NOT_REALISED;
	shot_current = ++shot_generation;
	shot_result_gen = 0;
	shot_state = 0;
	shot_len = 0;
	shot_w = 0;
	shot_h = 0;
	shot_scale = 1.0;
	shot_error[0] = 0;
	// Region/options 0 is the view's own render; the generation is the callback's user_data.
	shim_snapshot_start(web, 0, 0, 0, shim_snapshot_done, (void *)shot_current);
	return SHOT_STARTED;
}

unsigned long shim_snapshot_generation(void) { return shot_current; }
unsigned long shim_snapshot_result_generation(void) { return shot_result_gen; }

int shim_snapshot_state(void) { return shot_state; }
const char *shim_snapshot_failure(void) { return shot_error; }
long shim_snapshot_width(void) { return shot_w; }
long shim_snapshot_height(void) { return shot_h; }
double shim_snapshot_scale(void) { return shot_scale; }
long shim_snapshot_length(void) { return shot_len; }

// Length first, then an exact-size copy: one pass either truncates or copies a race.
long shim_snapshot_read(char *dst, long cap) {
	long i;
	if (!shot_bytes || shot_len <= 0) return -1;
	if (!dst || cap <= 0) return shot_len;
	for (i = 0; i < shot_len && i < cap; i++) dst[i] = shot_bytes[i];
	return shot_len;
}
