// --- initialising and placing a preview handler -----------------------------
// A handler implements at least one of three initialisers, and which one is the handler's choice, not
// the file's: Microsoft's own hosting sample tries stream, then file, then shell item for exactly that
// reason. The Office handlers accept the shell item, an unknown third-party one may accept only the
// stream, and the built-in text and image handlers take the file. All three put their single method
// in slot 3 of their own vtable.
//
// A refused `QueryInterface` is not a failure here: it means "this handler does not use that
// initialiser", and the next one is tried. Only when none answers does the preview fail, with
// E_NOINTERFACE — which is a different fact from a handler that accepted the file and then refused to
// render, and the step/hresult pair keeps them apart.
#define SHIM_PREVIEW_SLOT_QUERY_INTERFACE 0
#define SHIM_PREVIEW_SLOT_RELEASE 2
#define SHIM_PREVIEW_SLOT_INITIALIZE 3
#define SHIM_PREVIEW_SLOT_SET_WINDOW 3
#define SHIM_PREVIEW_SLOT_SET_RECT 4
#define SHIM_PREVIEW_SLOT_DO_PREVIEW 5
#define SHIM_PREVIEW_SLOT_UNLOAD 6
#define SHIM_STGM_READ 0u
#define SHIM_STGM_SHARE_DENY_NONE 0x40u
#define SHIM_FILE_ATTRIBUTE_NORMAL 0x80u
#define SHIM_E_NOINTERFACE (-2147467262)
#define SHIM_E_FAIL (-2147467259)

// The one Release every object gets, through the guarded accessor: a vtable pointer taken from an
// object that cannot be read is the jump the guard exists to prevent.
static void preview_release(void *obj) {
	void **vt;
	if (!obj) return;
	vt = shim_object_vtbl(obj);
	if (vt && shim_slot_ok(vt, SHIM_PREVIEW_SLOT_RELEASE)) ((unsigned int (*)(void *))vt[SHIM_PREVIEW_SLOT_RELEASE])(obj);
}

/** QueryInterface into `out`; 1 taken, 0 refused, and the HRESULT kept for the reason. */
static int preview_qi(void *obj, const unsigned char *iid, void **out) {
	void **vt = shim_object_vtbl(obj);
	int hr;
	if (!vt || !shim_slot_ok(vt, SHIM_PREVIEW_SLOT_QUERY_INTERFACE)) return 0;
	hr = ((int (*)(void *, const void *, void **))vt[SHIM_PREVIEW_SLOT_QUERY_INTERFACE])(obj, iid, out);
	return hr >= 0 && *out ? 1 : 0;
}

// The three initialisers, each one QI + one call. `grfMode` is STGM_READ, plus SHARE_DENY_NONE for the
// stream because opening it is a file open that the handler must not hold exclusively.
static int preview_init_with_stream(void *handler) {
	void *init = 0;
	void *stream = 0;
	void **vt;
	int hr;
	if (!preview_qi(handler, SHIM_IID_INIT_STREAM, &init)) return SHIM_E_NOINTERFACE;
	hr = SHCreateStreamOnFileEx(g_preview_path, SHIM_STGM_READ | SHIM_STGM_SHARE_DENY_NONE,
	                            SHIM_FILE_ATTRIBUTE_NORMAL, 0, 0, &stream);
	if (hr < 0 || !stream) {
		preview_release(init);
		return hr < 0 ? hr : SHIM_E_FAIL;
	}
	vt = shim_object_vtbl(init);
	hr = vt && shim_slot_ok(vt, SHIM_PREVIEW_SLOT_INITIALIZE)
	         ? ((int (*)(void *, void *, unsigned int))vt[SHIM_PREVIEW_SLOT_INITIALIZE])(init, stream,
	                                                                            SHIM_STGM_READ)
	         : SHIM_E_NOINTERFACE;
	preview_release(stream);
	preview_release(init);
	return hr;
}

static int preview_init_with_file(void *handler) {
	void *init = 0;
	void **vt;
	int hr;
	if (!preview_qi(handler, SHIM_IID_INIT_FILE, &init)) return SHIM_E_NOINTERFACE;
	vt = shim_object_vtbl(init);
	hr = vt && shim_slot_ok(vt, SHIM_PREVIEW_SLOT_INITIALIZE)
	         ? ((int (*)(void *, const shim_wchar *, unsigned int))vt[SHIM_PREVIEW_SLOT_INITIALIZE])(
	               init, g_preview_path, SHIM_STGM_READ)
	         : SHIM_E_NOINTERFACE;
	preview_release(init);
	return hr;
}

static int preview_init_with_item(void *handler) {
	void *init = 0;
	void *item = 0;
	void **vt;
	int hr;
	if (!preview_qi(handler, SHIM_IID_INIT_ITEM, &init)) return SHIM_E_NOINTERFACE;
	hr = SHCreateItemFromParsingName(g_preview_path, 0, SHIM_IID_SHELL_ITEM, &item);
	if (hr < 0 || !item) {
		preview_release(init);
		return hr < 0 ? hr : SHIM_E_FAIL;
	}
	vt = shim_object_vtbl(init);
	hr = vt && shim_slot_ok(vt, SHIM_PREVIEW_SLOT_INITIALIZE)
	         ? ((int (*)(void *, void *, unsigned int))vt[SHIM_PREVIEW_SLOT_INITIALIZE])(init, item,
	                                                                            SHIM_STGM_READ)
	         : SHIM_E_NOINTERFACE;
	preview_release(item);
	preview_release(init);
	return hr;
}

// 1 ready to be placed, 0 refused with the step and HRESULT recorded. Stream first because it is the
// model Microsoft's sample calls preferred, then the file, then the item.
static int preview_initialize(void *handler) {
	int hr = preview_init_with_stream(handler);
	if (hr >= 0) return 1;
	hr = preview_init_with_file(handler);
	if (hr >= 0) return 1;
	hr = preview_init_with_item(handler);
	if (hr >= 0) return 1;
	preview_failed_at(SHIM_PREVIEW_STEP_INITIALIZE, hr);
	return 0;
}

/** `SetRect`: the area, in the host window, the handler paints. 1 when the call answered. */
static void preview_set_rect(void *handler, int *rect) {
	void **vt = shim_object_vtbl(handler);
	if (!vt || !shim_slot_ok(vt, SHIM_PREVIEW_SLOT_SET_RECT)) return;
	((int (*)(void *, const int *))vt[SHIM_PREVIEW_SLOT_SET_RECT])(handler, rect);
}

// SetWindow, SetRect, DoPreview — the three calls that put the preview on screen, each recorded so a
// refusal names which one. `rect` is the host's own client rectangle, in its own coordinates.
static int preview_attach(void *handler, shim_h host, int w, int h) {
	void **vt = shim_object_vtbl(handler);
	int rect[4];
	int hr;
	if (!vt) return preview_failed_at(SHIM_PREVIEW_STEP_SET_WINDOW, SHIM_E_NOINTERFACE);
	rect[0] = 0;
	rect[1] = 0;
	rect[2] = w;
	rect[3] = h;
	if (!shim_slot_ok(vt, SHIM_PREVIEW_SLOT_SET_WINDOW))
		return preview_failed_at(SHIM_PREVIEW_STEP_SET_WINDOW, SHIM_E_NOINTERFACE);
	hr = ((int (*)(void *, shim_h, const int *))vt[SHIM_PREVIEW_SLOT_SET_WINDOW])(handler, host,
	                                                                            rect);
	if (hr < 0) return preview_failed_at(SHIM_PREVIEW_STEP_SET_WINDOW, hr);
	if (!shim_slot_ok(vt, SHIM_PREVIEW_SLOT_SET_RECT))
		return preview_failed_at(SHIM_PREVIEW_STEP_SET_RECT, SHIM_E_NOINTERFACE);
	hr = ((int (*)(void *, const int *))vt[SHIM_PREVIEW_SLOT_SET_RECT])(handler, rect);
	if (hr < 0) return preview_failed_at(SHIM_PREVIEW_STEP_SET_RECT, hr);
	if (!shim_slot_ok(vt, SHIM_PREVIEW_SLOT_DO_PREVIEW))
		return preview_failed_at(SHIM_PREVIEW_STEP_DO_PREVIEW, SHIM_E_NOINTERFACE);
	hr = ((int (*)(void *))vt[SHIM_PREVIEW_SLOT_DO_PREVIEW])(handler);
	if (hr < 0) return preview_failed_at(SHIM_PREVIEW_STEP_DO_PREVIEW, hr);
	return SHIM_PREVIEW_SHOWN;
}

/** `Unload`: the handler stops rendering and frees what it took for this file. */
static void preview_unload(void *handler) {
	void **vt = shim_object_vtbl(handler);
	if (!vt || !shim_slot_ok(vt, SHIM_PREVIEW_SLOT_UNLOAD)) return;
	((int (*)(void *))vt[SHIM_PREVIEW_SLOT_UNLOAD])(handler);
}
