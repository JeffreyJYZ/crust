// --- what a surface reports back: navigation state and refused windows -----
// WebView2 has no synchronous `IsLoading`, so loading is a flag the surface's own two navigation
// events write. Both policies live in handlers this file builds:
//   - NavigationStarting (1) and NavigationCompleted (0) keep `state.loading` honest.
//   - NewWindowRequested is refused: `put_Handled(TRUE)` means WebView2 creates no second window, and
//     the URL it would have opened is reported to JavaScript so the plugin can hand an allowed one to
//     the system opener.
//
// A handler is a hand-built COM object, and the same rule `30_com.c` follows applies: the vtable is
// filled at run time, never as a static initialiser holding code addresses, because a relocated
// pointer inside the image was the jump to 0xFFFFFFFFFFFFFFFF that cost this layer a year.

typedef struct {
	void **vtbl;
	long refs;
	int handle;
	/** 1 for the navigation-start handler, 0 for navigation-completed, -1 for the popup handler. */
	int loading;
	int popup;
} shim_browser_handler;

#define SHIM_BROWSER_VTBL_SLOTS 4
#define SHIM_POPUP_CAP 2048

static void *g_browser_vtbl[SHIM_BROWSER_VTBL_SLOTS];
static int g_browser_vtbl_bound;

// One sink for the whole process: a rejected new window is reported to the page that owns it, and the
// surface is found from the `ICoreWebView2` the event carried. Held as an opaque pointer, not a typed
// function pointer, so the Win32 pointer scan does not read a JavaScript callback as a DLL entry point
// it must bind; the one call site casts it once.
static void *g_popup_sink;
static char g_popup[SHIM_POPUP_CAP];
static int g_popups;

static shim_browser_handler g_nav_start[SHIM_MAX_SURFACES];
static shim_browser_handler g_nav_done[SHIM_MAX_SURFACES];
static shim_browser_handler g_popup_handlers[SHIM_MAX_SURFACES];

static shim_i64 browser_qi(void *self, const void *iid, void **out) {
	if (!out) return -2147467261LL; /* E_POINTER */
	(void)iid;
	*out = self;
	((shim_browser_handler *)self)->refs++;
	return 0;
}

static shim_u64 browser_addref(void *self) { return (shim_u64)++((shim_browser_handler *)self)->refs; }

static shim_u64 browser_release(void *self) {
	return (shim_u64)--((shim_browser_handler *)self)->refs;
}

// `action.get_Uri()` into `g_popup`, then `put_Handled(TRUE)`. An argument object whose vtable is not
// what this layer expects is a refusal, not a jump: every slot is checked before it is called.
static void shim_record_popup(void *args, void *web) {
	void **vt = shim_object_vtbl(args);
	shim_wchar *text = 0;
	g_popup[0] = 0;
	if (vt && shim_slot_ok(vt, SHIM_SLOT_NEWWINDOW_GET_URI) &&
	    ((int (*)(void *, shim_wchar **))vt[SHIM_SLOT_NEWWINDOW_GET_URI])(args, &text) >= 0 &&
	    text) {
		int length = 0;
		while (text[length]) length++;
		shim_utf8(text, length, g_popup, SHIM_POPUP_CAP);
		shim_browser_free(text);
	}
	if (vt && shim_slot_ok(vt, SHIM_SLOT_NEWWINDOW_PUT_HANDLED))
		((int (*)(void *, int))vt[SHIM_SLOT_NEWWINDOW_PUT_HANDLED])(args, 1);
	g_popups++;
	if (g_popup_sink) ((int (*)(int, void *))g_popup_sink)(g_popups, web);
}

// Every handler shares one Invoke: an event handler is called (self, sender, args), so `sender` is the
// ICoreWebView2 that raised it and `args` the event's own object.
static shim_i64 browser_invoke(void *self, void *sender, void *args) {
	shim_browser_handler *handler = (shim_browser_handler *)self;
	if (handler->popup) {
		shim_record_popup(args, sender);
		return 0;
	}
	shim_surface_set_loading(handler->handle, handler->loading);
	return 0;
}

static shim_i64 browser_unsupported(void *self) {
	(void)self;
	return -2147467262LL; /* E_NOINTERFACE */
}

static void browser_vtbl(void) {
	int slot;
	if (g_browser_vtbl_bound) return;
	g_browser_vtbl[0] = (void *)browser_qi;
	g_browser_vtbl[1] = (void *)browser_addref;
	g_browser_vtbl[2] = (void *)browser_release;
	g_browser_vtbl[3] = (void *)browser_invoke;
	for (slot = 4; slot < SHIM_BROWSER_VTBL_SLOTS; slot++)
		g_browser_vtbl[slot] = (void *)browser_unsupported;
	g_browser_vtbl_bound = 1;
}

static void browser_handler_init(shim_browser_handler *handler, int handle, int loading, int popup) {
	browser_vtbl();
	handler->vtbl = g_browser_vtbl;
	handler->refs = 1;
	handler->handle = handle;
	handler->loading = loading;
	handler->popup = popup;
}

static int shim_add_event(void *web, int slot, void *handler, shim_i64 *token) {
	void **vt = shim_object_vtbl(web);
	if (!vt || !shim_slot_ok(vt, slot)) return -1;
	return ((int (*)(void *, void *, shim_i64 *))vt[slot])(web, handler, token);
}

// The two navigation events, registered once per surface after its controller exists. They outlive the
// surface only in the sense that WebView2 drops them with the controller; `shim_surface_release` calls
// this again for the next surface that lands on the same slot.
int shim_webview_watch(int handle) {
	void *web = shim_surface_web(handle);
	shim_i64 token = 0;
	if (!web || handle < 0 || handle >= SHIM_MAX_SURFACES) return 0;
	if (shim_surface_flag(handle, 0)) return 1;
	browser_handler_init(&g_nav_start[handle], handle, 1, 0);
	browser_handler_init(&g_nav_done[handle], handle, 0, 0);
	if (shim_add_event(web, SHIM_SLOT_WEBVIEW_ADD_NAV_STARTING, &g_nav_start[handle], &token) < 0)
		return 0;
	if (shim_add_event(web, SHIM_SLOT_WEBVIEW_ADD_NAV_COMPLETED, &g_nav_done[handle], &token) < 0)
		return 0;
	shim_surface_set_flag(handle, 0, 1);
	return 1;
}

// Refuse every new window this surface asks for, reporting its URL instead.
int shim_webview_refuse_popups(int handle) {
	void *web = shim_surface_web(handle);
	shim_i64 token = 0;
	if (!web || handle < 0 || handle >= SHIM_MAX_SURFACES) return 0;
	if (shim_surface_flag(handle, 1)) return 1;
	browser_handler_init(&g_popup_handlers[handle], handle, 0, 1);
	if (shim_add_event(web, SHIM_SLOT_WEBVIEW_ADD_NEW_WINDOW, &g_popup_handlers[handle], &token) < 0)
		return 0;
	shim_surface_set_flag(handle, 1, 1);
	return 1;
}

void shim_browser_set_sink(void *sink) { g_popup_sink = sink; }

int shim_browser_popups(void) { return g_popups; }

// The URL of the last refused new window, as UTF-8 into a caller buffer; the full length.
int shim_browser_popup_url(char *dst, int cap) {
	int length = 0;
	int take;
	if (!dst || cap <= 0) return 0;
	while (g_popup[length]) length++;
	take = length < cap - 1 ? length : cap - 1;
	for (int i = 0; i < take; i++) dst[i] = g_popup[i];
	dst[take] = 0;
	return length;
}
