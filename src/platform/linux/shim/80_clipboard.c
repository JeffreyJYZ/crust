// --- clipboard -------------------------------------------------------------
// GTK3's clipboard: `gtk_clipboard_get(GDK_SELECTION_CLIPBOARD)`, `gtk_clipboard_wait_for_text` and
// `gtk_clipboard_set_text`. Resolved lazily with `shim_sym_or_null`, never in `shim_gtk_resolve`, so
// a GTK too old for one of these fails `clipboard` by name instead of refusing to launch every app.
//
// Images are a GdkPixbuf round trip — decode a PNG into a pixbuf, hand it to `gtk_clipboard_set_image`
// — which this shim does not carry; the TypeScript half refuses `readImage`/`writeImage` by name
// rather than answering an empty result a page would read as "the clipboard holds no image".
//
// **The one memory rule.** `gtk_clipboard_wait_for_text` returns a GLib allocation. Bun links
// mimalloc and exports its own `free`, so handing that string to the shim's `free` faults (measured
// at 0xA6D0 on ubuntu-sandbox); it goes back through GLib's own `g_free`, resolved here.

// GDK_SELECTION_CLIPBOARD is `((GdkAtom) 69)`, and a GdkAtom is a pointer — passing 69 as an `int`
// would leave the upper half of the register undefined at the call.
#define SHIM_GDK_SELECTION_CLIPBOARD 69

static void *(*shim_gtk_clipboard_get)(void *selection);
static void (*shim_gtk_clipboard_set_text)(void *clipboard, const char *text, int length);
static char *(*shim_gtk_clipboard_wait_for_text)(void *clipboard);
static void (*shim_gtk_clipboard_store)(void *clipboard);
static int shim_clipboard_resolved;

static void shim_clipboard_resolve(void) {
	if (shim_clipboard_resolved) return;
	void *h = shim_gtk_handle();
	shim_clipboard_resolved = 1;
	if (!h) return;
	shim_gtk_clipboard_get = shim_sym_or_null(h, "gtk_clipboard_get");
	shim_gtk_clipboard_set_text = shim_sym_or_null(h, "gtk_clipboard_set_text");
	shim_gtk_clipboard_wait_for_text = shim_sym_or_null(h, "gtk_clipboard_wait_for_text");
	// Optional: a store is a courtesy to clipboard managers, and GTK without one still copies.
	shim_gtk_clipboard_store = shim_sym_or_null(h, "gtk_clipboard_store");
	if (!shim_core_g_free) shim_core_g_free = shim_sym_or_null(h, "g_free");
}

// 1 when GTK carries every entry point the text half needs; 0 names a GDK that cannot copy.
int shim_clipboard_ready(void) {
	shim_clipboard_resolve();
	return shim_gtk_clipboard_get && shim_gtk_clipboard_set_text &&
	               shim_gtk_clipboard_wait_for_text && shim_core_g_free
	           ? 1
	           : 0;
}

// The clipboard's text as UTF-8 into a caller buffer: the full byte length, 0 for no text, -1 when
// there is no clipboard to read (GTK is not up, or the library is too old).
int shim_clipboard_read(char *dst, int cap) {
	if (!shim_clipboard_ready()) return -1;
	void *clipboard = shim_gtk_clipboard_get((void *)SHIM_GDK_SELECTION_CLIPBOARD);
	if (!clipboard) return -1;
	char *text = shim_gtk_clipboard_wait_for_text(clipboard);
	// NULL is the empty clipboard, or an owner that never answered — both are "no text", which is
	// what the empty string means to the plugin.
	if (!text) return 0;
	int length = 0;
	while (text[length]) length++;
	if (dst && cap > 0) {
		int take = length < cap - 1 ? length : cap - 1;
		for (int i = 0; i < take; i++) dst[i] = text[i];
		dst[take] = 0;
	}
	if (shim_core_g_free) shim_core_g_free(text);
	return length;
}

// 1 written, -1 no clipboard to write to. `gtk_clipboard_set_text` answers nothing and copies the
// string, so a returned 1 means GTK took the request — there is no verdict to read back, and this
// shim does not pretend there is one.
int shim_clipboard_write(const char *bytes, int length) {
	if (!bytes || length < 0) return -1;
	if (!shim_clipboard_ready()) return -1;
	void *clipboard = shim_gtk_clipboard_get((void *)SHIM_GDK_SELECTION_CLIPBOARD);
	if (!clipboard) return -1;
	shim_gtk_clipboard_set_text(clipboard, bytes, length);
	if (shim_gtk_clipboard_store) shim_gtk_clipboard_store(clipboard);
	return 1;
}
