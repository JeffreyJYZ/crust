// --- preview: an IPreviewHandler hosted in a child HWND ---------------------
// The Windows answer to QuickLook is not a floating panel: it is the shell's preview handler, created
// from the file's registered CLSID and hosted in a child window of the app's. The sequence is the one
// `ShObjIdl_core.idl` describes for `IPreviewHandler` — CoCreateInstance, initialise with the file,
// `SetWindow` + `SetRect`, `DoPreview` — and `hide` is `Unload` plus a released object plus the child
// window destroyed. `53_preview_host.c` owns the window and the CLSID lookup; `55_preview_init.c` owns
// the initialisers and the three placement calls.
//
// **Every refusal is named, because "no preview handler" is ordinary.** An unknown extension has no
// registration and a page has to be able to say so rather than show an empty rectangle. So `show`
// answers a status (0 shown, 1 no-handler, 2 preview-failed) and records the step it reached and the
// HRESULT that stopped it; `preview.ts` turns those into a sentence in the caller's words.
//
// The apartment is the app's own: `startup.ts` calls `CoInitializeEx(COINIT_APARTMENTTHREADED)` before
// any window exists, and COM is affine to that thread — the pump's. Nothing here creates an apartment.
#define SHIM_PREVIEW_PATH 0x8000
#define SHIM_PREVIEW_SHOWN 0
#define SHIM_PREVIEW_NO_HANDLER 1
#define SHIM_PREVIEW_FAILED 2
// The step `show` reached, so a refusal names the call rather than "it failed". `preview.ts` holds the
// same names in the same order; `preview-ids.test.ts` reads these numbers back out of this file.
#define SHIM_PREVIEW_STEP_NONE 0
#define SHIM_PREVIEW_STEP_RESOLVE 1
#define SHIM_PREVIEW_STEP_CREATE 2
#define SHIM_PREVIEW_STEP_INITIALIZE 3
#define SHIM_PREVIEW_STEP_SET_WINDOW 4
#define SHIM_PREVIEW_STEP_SET_RECT 5
#define SHIM_PREVIEW_STEP_DO_PREVIEW 6
#define SHIM_PREVIEW_STEP_HOST_WINDOW 7
#define SHIM_PREVIEW_STEP_ENTRY_POINTS 8
// CLSCTX_INPROC_SERVER | CLSCTX_LOCAL_SERVER: a built-in handler is normally in-process, and an
// Office or Photo handler may be a local server in `prevhost.exe`, so both routes are asked for.
#define SHIM_PREVIEW_CLSCTX 5u

static shim_h g_preview_host;
static void *g_preview_handler;
static shim_wchar g_preview_path[SHIM_PREVIEW_PATH];
static unsigned char g_preview_clsid[16];
static int g_preview_step;
static int g_preview_hresult;

// `53_preview_host.c` precedes this part and defines the window and CLSID helpers it calls. The rest
// live in `55_…`, which follows, so they are declared here — one translation unit, one file order.
static int preview_initialize(void *handler);
static int preview_attach(void *handler, shim_h host, int w, int h);
static void preview_set_rect(void *handler, int *rect);
static void preview_unload(void *handler);
static void preview_release(void *obj);

static int preview_failed_at(int step, int hr) {
	g_preview_step = step;
	g_preview_hresult = hr;
	return SHIM_PREVIEW_FAILED;
}

// One preview per process: a second `show` replaces the first, and `hide` leaves nothing behind. The
// host is checked with `IsWindow` first because a parent window closed underneath it destroys the
// child, and a COM handler holding that handle has to be released either way.
static void preview_clear(void) {
	if (g_preview_handler) {
		preview_unload(g_preview_handler);
		preview_release(g_preview_handler);
		g_preview_handler = 0;
	}
	if (g_preview_host) {
		if (IsWindow(g_preview_host)) DestroyWindow(g_preview_host);
		g_preview_host = 0;
	}
}

// 0 shown, 1 no-handler, 2 preview-failed. The file's own existence is the caller's check: this side
// would need another filesystem entry point to ask, and `preview.ts` refuses a path that is not a file
// before any COM call is made — so `not-a-file` never reaches Windows at all.
int shim_preview_show(const char *bytes, int length, shim_h parent, int x, int y, int w, int h) {
	void *handler = 0;
	int hr;
	g_preview_step = SHIM_PREVIEW_STEP_NONE;
	g_preview_hresult = 0;
	if (!shim_preview_ready()) return preview_failed_at(SHIM_PREVIEW_STEP_ENTRY_POINTS, 0);
	if (!parent || w <= 0 || h <= 0) return preview_failed_at(SHIM_PREVIEW_STEP_HOST_WINDOW, 0);
	if (shim_utf16(bytes, g_preview_path, SHIM_PREVIEW_PATH) < 0)
		return preview_failed_at(SHIM_PREVIEW_STEP_RESOLVE, 0);
	preview_clear();
	if (!preview_resolve(g_preview_path, g_preview_clsid)) return SHIM_PREVIEW_NO_HANDLER;
	g_preview_host = preview_host(parent, x, y, w, h);
	if (!g_preview_host) return preview_failed_at(SHIM_PREVIEW_STEP_HOST_WINDOW, 0);
	hr = CoCreateInstance(g_preview_clsid, 0, SHIM_PREVIEW_CLSCTX, SHIM_IID_PREVIEW, &handler);
	if (hr < 0 || !handler) {
		DestroyWindow(g_preview_host);
		g_preview_host = 0;
		return preview_failed_at(SHIM_PREVIEW_STEP_CREATE, hr);
	}
	if (!preview_initialize(handler)) {
		preview_release(handler);
		DestroyWindow(g_preview_host);
		g_preview_host = 0;
		return SHIM_PREVIEW_FAILED;
	}
	g_preview_handler = handler;
	hr = preview_attach(handler, g_preview_host, w, h);
	if (hr == SHIM_PREVIEW_SHOWN) return SHIM_PREVIEW_SHOWN;
	preview_clear();
	return hr;
}

// `SetWindowPos` for the child, then `SetRect` so a handler that caches its draw area follows. The
// rect is the child's own client rectangle: `SetWindow`'s area is "within the parent hwnd" — the host
// this unit created — not within the app window.
int shim_preview_size(int x, int y, int w, int h) {
	int rect[4];
	if (!g_preview_host || !IsWindow(g_preview_host)) return 0;
	if (!SetWindowPos(g_preview_host, 0, x, y, w, h, SHIM_SWP_GEOMETRY)) return 0;
	if (!g_preview_handler) return 1;
	rect[0] = 0;
	rect[1] = 0;
	rect[2] = w;
	rect[3] = h;
	preview_set_rect(g_preview_handler, rect);
	return 1;
}

// 1 after every call: "nothing was showing" is not a failure, and a page that hid twice has not erred.
int shim_preview_hide(void) {
	preview_clear();
	g_preview_step = SHIM_PREVIEW_STEP_NONE;
	g_preview_hresult = 0;
	return 1;
}

/** The host window, 0 when nothing is shown. Its liveness after `hide` is `IsWindow`, as a window is. */
shim_h shim_preview_hwnd(void) { return g_preview_host; }

/** The step the last `show` reached; the names live in `preview.ts`, in this order. */
int shim_preview_step(void) { return g_preview_step; }

/** The HRESULT that stopped that step, sign-extended so a test in JavaScript sees the sign. */
shim_i64 shim_preview_hresult(void) { return (shim_i64)g_preview_hresult; }
