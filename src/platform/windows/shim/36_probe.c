// --- what a probe reads back -----------------------------------------------
// Every number here exists because a call in this layer failed in a way only a pointer explains: a jump
// to 0xFFFFFFFFFFFFFFFF is a vtable read past its end, or an object that is not the one it claims to
// be. Printing them before the call turns each of those into a visible equality.
//
// `CoGetApartmentType` is `int`, not `shim_i64`: it returns a 32-bit HRESULT and a wider declaration
// reads an undefined top half of RAX. `-1` used to mean three different things, so the binding and the
// raw HRESULT are separate exports now.

// 1 when the bytes Windows reads as the vtable pointer really are the table this layer filled.
int shim_handler_prepare(void) {
	void *table;
	handler_init(&g_env_handler, SHIM_THREAD_ENV_CALLBACK);
	handler_init(&g_ctrl_handler, SHIM_THREAD_CTRL_CALLBACK);
	table = (void *)(shim_h)shim_handler_vtbl_addr();
	return *(void **)&g_env_handler == table ? 1 : 0;
}

shim_i64 shim_handler_object_addr(void) { return (shim_i64)(void *)&g_env_handler; }


shim_i64 shim_handler_first_field(void) { return (shim_i64)(void *)*(void **)&g_env_handler; }


/**
 * What WebView2 handed the callback, per step — kept beside what `result` holds now. Equal means the
 * object we read later is the object it passed; different means the field was overwritten after the
 * store (a second `handler_init`), which is a different fix from "WebView2 passed a non-object".
 */
void *shim_handler_created(int step) {
	if (step == SHIM_THREAD_ENV_CALLBACK) return g_env_handler.created;
	if (step == SHIM_THREAD_CTRL_CALLBACK) return g_ctrl_handler.created;
	return 0;
}

/**
 * 1 when the controller completion fired inside `CreateCoreWebView2Controller`, 0 when a later pump
 * iteration got it. An inline completion means the webview was constructed reentrantly and never saw a
 * message loop — the measurement that decides whether a fault on the first `Navigate` is ours.
 */
int shim_ctrl_inline(void) { return g_ctrl_inline; }

// Where the controller call was made: 2 right after `create_env` returned, 3 after a pump, 4 the
// fallback. 1 would mean back inside the callback, which is the shape that produced a half-built object.
int shim_ctrl_from(void) { return g_ctrl_from; }

// 1 = deferral (default), 2 = create from `shim_controller_begin`. Returns the previous mode, so 0 reads
// it back. The probe runs one child per mode, which tests the move without touching the product path.
int shim_ctrl_mode(int mode) {
	int previous = g_ctrl_mode;
	if (mode == 1 || mode == 2) g_ctrl_mode = mode;
	return previous;
}
static int g_apartment_hresult;
static int g_apartment_type;
static int g_apartment_qualifier;

// 0 STA, 1 MTA, 2 neutral, 3 main STA, -1 when the call failed. `1` is MTA: reading it as STA inverts
// the verdict.
int shim_apartment_type(void) {
	int type = 0;
	int qualifier = 0;
	g_apartment_type = -1;
	g_apartment_qualifier = 0;
	g_apartment_hresult = 0;
	if (!CoGetApartmentType) return -1;
	// Two real out-params: the qualifier is not optional, and passing NULL answered E_INVALIDARG
	// (0x80070057) on the runner — which read as "not initialised" for two runs.
	g_apartment_hresult = CoGetApartmentType(&type, &qualifier);
	if (g_apartment_hresult != 0) return -1;
	g_apartment_type = type;
	g_apartment_qualifier = qualifier;
	return type;
}

/** APTTYPEQUALIFIER beside the type: 0 none, 1 implicit MTA, 2 STA by NTA, 3 NA, 4 main STA, … */
int shim_apartment_qualifier(void) { return g_apartment_qualifier; }

// 1 when `CoGetApartmentType` resolved at all, so a binding failure is not mistaken for a bad apartment.
int shim_apartment_bound(void) { return CoGetApartmentType ? 1 : 0; }

// The raw HRESULT of the last `shim_apartment_type` call: 0x800401F0 (CO_E_NOTINITIALIZED) is a
// different diagnosis from "the symbol was never bound", which `shim_apartment_bound` answers.
shim_i64 shim_apartment_hresult(void) { return (shim_i64)g_apartment_hresult; }

// The two objects the controller path holds. Equal addresses mean the wrong one was stored.
/**
 * The refcount `AddRef` answered for the object a callback was handed, per step: > 0 means the reference
 * was taken and the object we stored is ours; 0 means the object refused; -1 means it could not be read or
 * the AddRef slot was not code. Printed beside `stored`/`read`, because a borrowed object that nobody
 * AddRef'd is exactly what produced `0xffffffff` where a vtable belongs.
 */
int shim_handler_addref(int step) {
	if (step == SHIM_THREAD_ENV_CALLBACK) return g_env_handler.addref;
	if (step == SHIM_THREAD_CTRL_CALLBACK) return g_ctrl_handler.addref;
	return 0;
}

/**
 * The first `words` 32-bit words of `obj`, written into a caller-owned buffer, or 0 when the object is
 * unreadable. "Not a COM object" is provable this way rather than inferred: ASCII, a small integer, or a
 * duplicate of the handler table each names what was actually stored.
 */
int shim_object_bytes(void *obj, void *out, int words) {
	unsigned int *dst = (unsigned int *)out;
	const unsigned int *src;
	int i;
	if (!dst || words <= 0 || !shim_is_readable(obj)) return 0;
	src = (const unsigned int *)obj;
	for (i = 0; i < words; i++) dst[i] = src[i];
	return i;
}

void *shim_controller_addr(void) { return shim_controller_handle(); }
void *shim_environment_addr(void) { return shim_environment_handle(); }

// The vtable pointer Windows will read out of the controller, and one entry of it. Compared against
// `shim_handler_vtbl_addr()` this says whether the object is a controller at all.
void *shim_controller_vtbl(void) {
	return (void *)shim_object_vtbl(shim_controller_handle());
}

void *shim_controller_slot(int index) {
	void **vt = shim_object_vtbl(shim_controller_handle());
	if (!vt || index < 0 || index >= 32) return 0;
	return vt[index];
}
