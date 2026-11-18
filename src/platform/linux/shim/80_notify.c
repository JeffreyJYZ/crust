// --- `crust:notification` on Linux, over libnotify -------------------------
// Its own compilation unit, compiled by `notify-tray-ffi.ts`, for the reason the Windows unit is
// separate and darwin's notification unit is: it shares nothing with the window shim, so
// `shim-source.ts`, `shim-ffi.ts` and the shared `PREFLIGHT` table are untouched by it.
//
// No #include: libnotify, GLib and GObject are reached through dlopen/dlsym, so the unit links
// nothing but libc — the same rule the window shim follows, and the reason a machine without
// libnotify gets a named refusal instead of a load-time fault.
//
// **Why libnotify and not the D-Bus method.** `notify_notification_show` marshals
// `org.freedesktop.Notifications.Notify` itself, including the `susssasa{sv}i` signature — a variant
// dictionary built by hand would be a second marshalling layer written blind. So: libnotify when the
// library resolves, and a refusal that names `libnotify.so.4` when it does not.
//
// Nothing but ints and NUL-terminated strings crosses bun:ffi. A `GError` is read here and copied
// into this unit's own buffer; GLib memory goes back through `g_error_free`, never `free` — Bun
// exports its own allocator, so handing it a GLib block faults (measured on ubuntu-sandbox).

typedef void GError;
typedef void GObject;
typedef void GtkStatusIcon;

extern void *dlopen(const char *file, int mode);
extern void *dlsym(void *handle, const char *name);

#define SHIM_RTLD_NOW 2
#define SHIM_RTLD_GLOBAL 0x100

static void *g_notify;
static int g_notify_state; // 0 untried, 1 ready, -1 a library or a symbol was missing
static int g_notify_init;
static void *g_notify_last;
static char g_missing[64];
static char g_reason[512];

// --- the buffer both parts share -------------------------------------------

static void shim_copy(char *dst, int cap, const char *src) {
	int i = 0;
	if (!dst || cap <= 0) return;
	if (!src) {
		dst[0] = 0;
		return;
	}
	while (src[i] && i < cap - 1) {
		dst[i] = src[i];
		i++;
	}
	dst[i] = 0;
}

// Bounded, always NUL-terminated: this buffer crosses bun:ffi as a cstring, and an unterminated one
// there is a read past the end.
static void shim_reason(const char *what, const char *detail) {
	int used = 0;
	shim_copy(g_reason, 512, what);
	while (g_reason[used]) used++;
	if (detail && detail[0] && used < 500) {
		g_reason[used++] = ':';
		g_reason[used++] = ' ';
		shim_copy(g_reason + used, 512 - used, detail);
	}
}

const char *shim_notify_reason(void) { return g_reason; }
const char *shim_notify_missing(void) { return g_missing; }

// Resolve one entry point and record its absence by name, so the message names the symbol rather
// than "libnotify is missing".
static int shim_sym(void *handle, const char *name, void **out) {
	if (!handle) {
		shim_copy(g_missing, 64, name);
		return 0;
	}
	*out = dlsym(handle, name);
	if (!*out) {
		shim_copy(g_missing, 64, name);
		return 0;
	}
	return 1;
}

// --- libnotify -------------------------------------------------------------

static int (*notify_init)(const char *app_name);
static void *(*notify_notification_new)(const char *summary, const char *body, const char *icon);
static int (*notify_notification_show)(void *note, GError **error);
static int (*notify_notification_close)(void *note, GError **error);
static void (*g_object_unref)(GObject *object);
static void (*g_error_free)(GError *error);

// `GError` is `{ GQuark domain; gint code; gchar *message; }` — 32-bit, 32-bit, pointer.
typedef struct {
	unsigned int domain;
	int code;
	char *message;
} shim_gerror;

// Copy a GError's message into the reason buffer and free it with GLib's own free.
static void shim_reason_from_error(const char *what, GError *error) {
	if (!error) {
		shim_reason(what, "no GError was set");
		return;
	}
	shim_gerror *detail = (shim_gerror *)error;
	shim_reason(what, detail->message ? detail->message : "an empty GError message");
	if (g_error_free) g_error_free(error);
}

// 1 when libnotify resolved every entry point; 0 with the gap named by `shim_notify_missing`.
int shim_notify_load(void) {
	if (g_notify_state) return g_notify_state > 0;
	g_notify_state = -1;
	g_missing[0] = 0;
	g_notify = dlopen("libnotify.so.4", SHIM_RTLD_NOW | SHIM_RTLD_GLOBAL);
	if (!g_notify) {
		shim_copy(g_missing, 64, "libnotify.so.4");
		return 0;
	}
	if (!shim_sym(g_notify, "notify_init", (void **)&notify_init)) return 0;
	if (!shim_sym(g_notify, "notify_notification_new", (void **)&notify_notification_new)) return 0;
	if (!shim_sym(g_notify, "notify_notification_show", (void **)&notify_notification_show)) return 0;
	if (!shim_sym(g_notify, "notify_notification_close", (void **)&notify_notification_close))
		return 0;
	// GLib and GObject are libnotify's own dependencies, so dlsym on its handle finds them — the same
	// way the window shim resolves GLib symbols from the GTK handle.
	if (!shim_sym(g_notify, "g_object_unref", (void **)&g_object_unref)) return 0;
	if (!shim_sym(g_notify, "g_error_free", (void **)&g_error_free)) return 0;
	g_notify_state = 1;
	return 1;
}

int shim_notify_ready(void) { return shim_notify_load(); }

// Close and release the previous notification: the server owns the visible one, but this unit holds
// the object, so a second `notify` would otherwise leak one GObject per call.
static void shim_notify_release(void) {
	if (!g_notify_last) return;
	if (notify_notification_close) {
		GError *error = 0;
		notify_notification_close(g_notify_last, &error);
		if (error && g_error_free) g_error_free(error);
	}
	if (g_object_unref) g_object_unref((GObject *)g_notify_last);
	g_notify_last = 0;
}

// 0 the server was asked and libnotify reported success, 2 an entry point did not resolve,
// 3 libnotify or the server refused. `notify_notification_show` is synchronous: it returns the
// server's own answer, so a 0 here is the daemon's word rather than this unit's optimism.
int shim_notify_post(const char *title, const char *body) {
	if (!shim_notify_load()) return 2;
	if (!title || !title[0]) {
		shim_reason("no summary was given", "notify_notification_new needs a non-empty summary");
		return 3;
	}
	if (!g_notify_init) {
		if (!notify_init("crust")) {
			shim_reason("notify_init returned FALSE", "no session bus for the notification daemon");
			return 3;
		}
		g_notify_init = 1;
	}
	shim_notify_release();
	void *note = notify_notification_new(title, body ? body : "", 0);
	if (!note) {
		shim_reason("notify_notification_new returned NULL", "out of memory");
		return 3;
	}
	GError *error = 0;
	int ok = notify_notification_show(note, &error);
	if (!ok) {
		shim_reason_from_error("notify_notification_show returned FALSE", error);
		if (g_object_unref) g_object_unref((GObject *)note);
		return 3;
	}
	g_notify_last = note;
	shim_reason("notify_notification_show returned TRUE", "the daemon accepted it");
	return 0;
}

// Dismiss the notification this unit last posted. 1 closed, 0 nothing was showing.
int shim_notify_close(void) {
	if (!shim_notify_load()) return 0;
	int had = g_notify_last ? 1 : 0;
	shim_notify_release();
	shim_reason("the last notification was closed", had ? "libnotify was asked" : "nothing was showing");
	return had;
}
