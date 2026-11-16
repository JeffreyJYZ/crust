// crust Linux shim — compiled at launch by bun:ffi's cc(). No #include at all:
// every GTK/WebKit symbol is a hand-written prototype reached through
// dlopen/dlsym, so the unit links nothing beyond libc and a missing library or
// symbol comes back as a message instead of a load-time crash. One fixed
// prototype per call, no struct or object crosses bun:ffi, and every string is
// bytes on this side. GTK objects are opaque: only their address leaves C.

typedef void GtkWidget;
typedef void GtkWindow;
typedef void GtkContainer;
typedef void WebKitWebView;

extern void *dlopen(const char *file, int mode);
extern void *dlsym(void *handle, const char *name);
// Bun links mimalloc and exports its own malloc/free, so these two are Bun's
// allocator rather than libc's. Never hand either one a block GLib allocated:
// its header belongs to a foreign heap. GLib memory goes back through the g_free
// the webview part resolves (measured: a GLib string freed with the shim's free
// faulted at address 0xA6D0 on ubuntu-sandbox).
extern void *malloc(unsigned long size);
extern void free(void *p);

#define RTLD_NOW 2
#define RTLD_GLOBAL 0x100

static void *shim_gtk;
static void *shim_webkit;
static int shim_ready;
static char shim_error[512];

// Bounded copy, always NUL-terminated: this buffer crosses bun:ffi as a
// cstring, and an unterminated one there is a read past the end.
static void shim_set_error(const char *what, const char *detail) {
	int i = 0;
	int j = 0;
	while (what && what[i] && i < 200) {
		shim_error[i] = what[i];
		i++;
	}
	if (detail && i < 200) {
		shim_error[i++] = ' ';
		while (detail[j] && i < 500) {
			shim_error[i++] = detail[j++];
		}
	}
	shim_error[i] = 0;
}

const char *shim_lib_error_text(void) { return shim_error; }

static void *shim_open(const char *soname) {
	void *h = dlopen(soname, RTLD_NOW | RTLD_GLOBAL);
	if (!h) shim_set_error("cannot load", soname);
	return h;
}

// Resolve one entry point and record its absence by name, so the message names
// the exact symbol rather than "GTK is missing".
static int shim_sym(void *handle, const char *name, void **out) {
	if (!handle) {
		shim_set_error("no handle for symbol", name);
		return 0;
	}
	*out = dlsym(handle, name);
	if (!*out) {
		shim_set_error("missing symbol", name);
		return 0;
	}
	return 1;
}

// Resolve without recording: an entry point the layer can live without must not
// turn into "missing symbol" for the whole launch. The proof calls these, and a
// library too old to carry one fails that proof's own step by name instead.
static void *shim_sym_or_null(void *handle, const char *name) {
	if (!handle) return 0;
	return dlsym(handle, name);
}

void *shim_gtk_handle(void) { return shim_gtk; }
void *shim_webkit_handle(void) { return shim_webkit; }

// Defined in the later parts, each unit resolving its own symbols from the
// library that provides them; this function opens both handles first.
int shim_webkit_resolve(void);
int shim_gtk_resolve(void);
int shim_pump_resolve(void);

int shim_lib_open(void) {
	// `shim_ready`, not the handles: a failed resolve leaves both handles set, so
	// checking them alone would report success on a retry that resolved nothing.
	if (shim_ready) return 1;
	shim_error[0] = 0;
	shim_gtk = shim_open("libgtk-3.so.0");
	if (!shim_gtk) return 0;
	// WebKit is opened second because it pulls GTK in itself; both handles are
	// kept, and each part resolves its symbols from its own library.
	shim_webkit = shim_open("libwebkit2gtk-4.1.so.0");
	if (!shim_webkit) return 0;
	if (!shim_webkit_resolve()) return 0;
	if (!shim_gtk_resolve()) return 0;
	if (!shim_pump_resolve()) return 0;
	shim_ready = 1;
	return 1;
}
